-- Analytics (daily active users) and fraud / anomaly detection (rules, alerts). Additive only.

-- One row per person per Maseru day they used the app (written at most once a day per person).
CREATE TABLE user_activity (
  day      date NOT NULL,
  user_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app      text NOT NULL,
  PRIMARY KEY (day, user_id, app)
);

-- What the risk rules flagged or blocked. Staff review them in the portal (Risk).
CREATE TABLE risk_alerts (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rule            text NOT NULL,
  action          text NOT NULL CHECK (action IN ('flagged', 'blocked')),
  severity        text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  detail          text NOT NULL,
  amount_cents    bigint,
  kind            text,
  transaction_id  text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fraud', 'ok')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_alerts_status_idx ON risk_alerts (status, created_at DESC);
CREATE INDEX risk_alerts_user_idx ON risk_alerts (user_id, created_at DESC);
