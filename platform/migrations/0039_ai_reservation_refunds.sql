-- Keep debits immutable and link one compensating credit to each reservation.
ALTER TABLE task_event ADD COLUMN ai_reservation_state text
  CHECK (ai_reservation_state IN ('reserved','settled','refunded'));
ALTER TABLE task_event ADD COLUMN reservation_generation integer NOT NULL DEFAULT 1 CHECK(reservation_generation>0);
ALTER TABLE task_event ADD COLUMN reversal_of uuid;
ALTER TABLE task_event ADD CONSTRAINT task_event_workspace_id_key UNIQUE(workspace_id,id);
ALTER TABLE task_event ADD CONSTRAINT task_event_refund_workspace_fkey FOREIGN KEY(workspace_id,reversal_of) REFERENCES task_event(workspace_id,id);
CREATE UNIQUE INDEX task_event_one_refund_idx ON task_event(reversal_of) WHERE reversal_of IS NOT NULL;
ALTER TABLE task_event ADD COLUMN credit_period date;
UPDATE task_event SET credit_period = date_trunc('month',created_at)::date;
ALTER TABLE task_event ALTER COLUMN credit_period SET DEFAULT date_trunc('month',now())::date;
ALTER TABLE task_event ALTER COLUMN credit_period SET NOT NULL;
-- NULL means historical funding allocation is unknown; never guess purchased credits.
ALTER TABLE task_event ADD COLUMN purchased_ai_credits numeric(12,3)
  CHECK (purchased_ai_credits >= 0 AND purchased_ai_credits <= ai_credits - trial_ai_credits);
UPDATE task_event SET ai_reservation_state='settled'
  WHERE status='succeeded' AND (action_type='ai' OR action_type LIKE 'ai.%');
-- In-flight and failed pre-approval workflow reservations need reconciliation.
UPDATE task_event e SET ai_reservation_state='reserved'
 FROM workflow_run r WHERE r.id=e.run_id AND r.workspace_id=e.workspace_id
 AND e.ai_reservation_state='settled' AND r.status IN ('pending','queued','running','failed','dead_lettered')
 AND NOT EXISTS(SELECT 1 FROM approval_request a WHERE a.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM run_event v WHERE v.run_id=r.id AND v.event_type='action_plan.created'
   AND COALESCE((v.payload->'actionPlan'->>'blockedByCompliance')::boolean,false)=false);

CREATE INDEX task_event_credit_period_idx ON task_event(workspace_id,credit_period);
CREATE INDEX task_event_reserved_idx ON task_event(workspace_id,id) WHERE ai_reservation_state='reserved';
