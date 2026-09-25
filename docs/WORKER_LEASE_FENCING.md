# Long AI job leases

`import.classify`, `insight.generate`, and `topics.cluster` renew their claim every
30 seconds, including while waiting for remote AI. Every workspace transaction
first renews and locks the job row with the exact job/workspace/worker/attempt and
an unexpired running lease. The lock remains through result, billing and audit
writes, so a superseded execution cannot commit results or mark the new job failed.

Loss of ownership or heartbeat database failure fails closed. A pending remote
request may still consume supplier work; its late result cannot be committed by
the old claimant. The queue's existing five-minute recovery window is unchanged.
The timer is cleared on every exit and heartbeat calls never overlap.

Tests use a virtual 20-minute wait, ownership loss and database failure, plus the
existing classification/insight/credit regressions. Real PostgreSQL multi-worker
crash/reclaim acceptance is still required before declaring production recovery
verified. This change does not add leases to non-AI supplier jobs.
