-- Iteration 4 (V1.0 最小闭环): 报告外发闭环 —— 洞察报告 → 人工审批 → 推送邮箱/Discord。
-- approval_request 原来强制绑定 workflow_run（run_id NOT NULL），洞察报告没有
-- workflow_run，因此把 run_id 放开为可空，并新增 insight_report_id 作为第二种
-- 审批主体；CHECK 约束保证两者至少其一。报告上的 delivery jsonb 记录外发状态机：
-- awaiting_approval → approved → delivered / failed（或 rejected）。

ALTER TABLE approval_request ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE approval_request ADD COLUMN insight_report_id uuid REFERENCES insight_report(id) ON DELETE CASCADE;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_subject_check
  CHECK (run_id IS NOT NULL OR insight_report_id IS NOT NULL);

CREATE INDEX approval_request_insight_report_idx ON approval_request (insight_report_id) WHERE insight_report_id IS NOT NULL;

ALTER TABLE insight_report ADD COLUMN delivery jsonb NOT NULL DEFAULT '{}'::jsonb;
