CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content JSONB NOT NULL,
  source TEXT NOT NULL,
  channel_id TEXT,
  agent TEXT NOT NULL DEFAULT 'conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_agent ON messages(agent);
