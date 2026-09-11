-- Iteration 3 (P1 templates): extend the insight_report template CHECK with
-- review_attribution (店铺差评归因), community_digest (社群摘要),
-- daily_ops (每日运营任务). Same runtime, new template definitions.

ALTER TABLE insight_report DROP CONSTRAINT insight_report_template_check;
ALTER TABLE insight_report ADD CONSTRAINT insight_report_template_check
  CHECK (template IN (
    'content_recap', 'comment_insights', 'product_opportunities',
    'review_attribution', 'community_digest', 'daily_ops'
  ));

-- 每日运营任务调度器（egg schedule 每天调用一次）。跨租户枚举只能在
-- SECURITY DEFINER 函数里做（与 claim_next_job 同一模式）；租户表全部
-- FORCE RLS，普通连接读不到别家数据。幂等：20 小时内已有 daily_ops
-- 报告的工作区跳过。
CREATE OR REPLACE FUNCTION enqueue_daily_ops_reports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ws RECORD;
  owner_id uuid;
  new_report_id uuid;
  batch_ids jsonb;
  item_total integer;
  enqueued integer := 0;
BEGIN
  FOR ws IN
    SELECT wb.workspace_id
      FROM workspace_billing wb
     WHERE (wb.subscription_status IN ('active', 'trialing') OR wb.trial_ends_at > now())
       AND EXISTS (SELECT 1 FROM import_batch b
                    WHERE b.workspace_id = wb.workspace_id AND b.status = 'classified')
       AND NOT EXISTS (SELECT 1 FROM insight_report r
                        WHERE r.workspace_id = wb.workspace_id AND r.template = 'daily_ops'
                          AND r.created_at > now() - interval '20 hours')
     ORDER BY wb.workspace_id
     LIMIT 200
  LOOP
    SELECT m.user_id INTO owner_id
      FROM workspace_membership m
     WHERE m.workspace_id = ws.workspace_id AND m.role = 'owner'
     ORDER BY m.user_id
     LIMIT 1;
    IF owner_id IS NULL THEN CONTINUE; END IF;

    SELECT COALESCE(jsonb_agg(batch_id), '[]'::jsonb) INTO batch_ids
      FROM (SELECT b.id AS batch_id FROM import_batch b
             WHERE b.workspace_id = ws.workspace_id AND b.status = 'classified'
             ORDER BY b.created_at DESC LIMIT 5) recent;
    SELECT COUNT(*) INTO item_total
      FROM import_item i
      JOIN import_batch b ON b.id = i.batch_id
     WHERE b.workspace_id = ws.workspace_id AND b.status = 'classified';

    INSERT INTO insight_report (workspace_id, template, title, model_band, batch_ids, item_count, created_by)
    VALUES (ws.workspace_id, 'daily_ops', '每日运营任务 · ' || to_char(now(), 'YYYY-MM-DD'), 'eco', batch_ids, item_total, owner_id)
    RETURNING id INTO new_report_id;

    INSERT INTO job (workspace_id, kind, payload)
    VALUES (ws.workspace_id, 'insight.generate', jsonb_build_object('reportId', new_report_id));

    enqueued := enqueued + 1;
  END LOOP;
  RETURN enqueued;
END;
$$;

-- 只许平台内部调用：回收 PUBLIC 执行权（与 0015 对 claim_next_job 的收紧一致）。
REVOKE EXECUTE ON FUNCTION enqueue_daily_ops_reports() FROM PUBLIC;
