-- Moqoqo Assistant (AI chat) and notification channels (push, SMS, email) with per-user choices.
-- Additive only. The "Moqoqo Assistant" system account (users.biller = 'assistant') is ensured by the seed.

-- ---------- assistant ----------
-- 'action': the assistant prepared something for the user to review and confirm with their PIN (never moves money).
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('text', 'money', 'mpho', 'request', 'receipt', 'system', 'action'));
ALTER TABLE messages ADD COLUMN action jsonb;

-- The conversation as the Claude API sees it (user turns, assistant turns with thinking and tool calls, tool results),
-- kept separately from the chat messages people see. Append-only, so earlier turns are replayed byte for byte.
CREATE TABLE assistant_turns (
  seq         bigserial PRIMARY KEY,
  chat_id     text NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,                 -- JSON exactly as sent to the API (not jsonb: that would reorder keys)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_turns_chat_idx ON assistant_turns (chat_id, seq);

-- ---------- notifications ----------
ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Only the switches a user changed; everything else follows DEFAULT_NOTIFICATION_PREFS in shared/api.ts.
CREATE TABLE notification_prefs (
  user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel   text NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
  category  text NOT NULL CHECK (category IN ('money', 'requests', 'ecosure', 'chats', 'news')),
  enabled   boolean NOT NULL,
  PRIMARY KEY (user_id, channel, category)
);

-- One pending code per user for confirming an email address (only the hash is kept).
CREATE TABLE email_codes (
  user_id     text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL
);

-- Everything sent (or, while a provider is still a mock, everything that would have been sent).
CREATE TABLE notifications (
  id          text PRIMARY KEY,
  user_id     text REFERENCES users (id) ON DELETE SET NULL,
  channel     text NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
  category    text NOT NULL CHECK (category IN ('money', 'requests', 'ecosure', 'chats', 'news', 'security')),
  recipient   text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('sent', 'mock', 'failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_created_idx ON notifications (created_at DESC);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
