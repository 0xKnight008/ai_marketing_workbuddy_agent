-- Support tickets are global, admin-side records. They are written only by
-- server code; client roles receive no direct table grants or RLS policy.
CREATE TABLE feedback_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text UNIQUE NOT NULL,
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'platform')),
  workspace_id uuid REFERENCES workspace(id) ON DELETE SET NULL,
  email citext NOT NULL,
  name text,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('billing', 'bug', 'feature', 'other')),
  message text NOT NULL CHECK (char_length(message) <= 2000),
  locale text,
  page_url text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'closed')),
  discord_thread_id text,
  replied_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz
);

CREATE TABLE feedback_reply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL REFERENCES feedback_message(ticket_no) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  author text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_message_status_created_idx ON feedback_message (status, created_at DESC);
CREATE INDEX feedback_message_workspace_created_idx ON feedback_message (workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX feedback_reply_ticket_created_idx ON feedback_reply (ticket_no, created_at);
