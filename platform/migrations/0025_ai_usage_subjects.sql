-- Iteration 5: AI credits 计量 —— 分类与洞察生成按 run 扣费。
-- task_event 原来强制绑定 workflow_run（run_id NOT NULL），但 import.classify 和
-- insight.generate 没有 workflow_run。放开 run_id 为可空，新增多态 subject_id
-- （import_batch.id 或 insight_report.id，无 FK），并重建幂等索引：
-- 同一主体 + 动作 + attempt 只计费一次（job 重试/重复入队不重复扣费）。

ALTER TABLE task_event ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE task_event ADD COLUMN subject_id uuid;
ALTER TABLE task_event ADD CONSTRAINT task_event_subject_check
  CHECK (run_id IS NOT NULL OR subject_id IS NOT NULL);

DROP INDEX task_event_idempotency_idx;
CREATE UNIQUE INDEX task_event_idempotency_idx
  ON task_event (COALESCE(run_id, subject_id), COALESCE(step_run_id, '00000000-0000-0000-0000-000000000000'::uuid), action_type, attempt);
