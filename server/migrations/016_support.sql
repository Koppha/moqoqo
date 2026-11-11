-- Help & support: tickets opened by the assistant (or by people writing to EcoCash Support), and what the assistant
-- did, for the portal's support analytics. Additive only. The "EcoCash Support" account (biller 'support') is seeded.

CREATE SEQUENCE support_ticket_seq START 1;
CREATE TABLE support_tickets (
  id                 text PRIMARY KEY,
  reference          text NOT NULL UNIQUE DEFAULT ('SUP-' || lpad(nextval('support_ticket_seq')::text, 6, '0')),
  user_id            text NOT NULL REFERENCES users (id),
  topic              text NOT NULL CHECK (topic IN ('payments', 'account', 'kyc', 'ecosure', 'cards_banks', 'fraud', 'other')),
  summary            text NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'closed')),
  assigned_to        text,
  first_response_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, updated_at DESC);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);

CREATE TABLE assistant_events (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        text NOT NULL,          -- question, answer, tool, handover, refusal, error, limit
  detail      text,                   -- tool name, topic
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_events_time_idx ON assistant_events (created_at);
