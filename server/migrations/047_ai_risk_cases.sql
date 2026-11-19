-- AI governance (model versions, decision log), behavioural fraud score, transaction surveillance and financial
-- crime case management. Additive only.

-- Every change to a model's mode or thresholds is a new row; the current version is the highest per key.
CREATE TABLE ai_model_versions (
  model       text NOT NULL,
  version     int NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('off', 'shadow', 'active')),
  params      jsonb NOT NULL DEFAULT '{}',
  changed_by  text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model, version)
);

-- What each model decided and why. Payments let through without a flag are kept 90 days (the surveillance sweep
-- deletes older ones); everything else is kept.
CREATE TABLE ai_decisions (
  id              text PRIMARY KEY,
  model           text NOT NULL,
  version         int NOT NULL,
  shadow          boolean NOT NULL DEFAULT false,
  user_id         text REFERENCES users (id) ON DELETE SET NULL,
  score           int,
  outcome         text NOT NULL CHECK (outcome IN ('allow', 'flag', 'block', 'info')),
  reasons         jsonb NOT NULL DEFAULT '[]',
  summary         text NOT NULL DEFAULT '',
  amount_cents    bigint,
  kind            text,
  transaction_id  text,
  case_id         text,
  review          text CHECK (review IN ('fraud', 'ok')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_decisions_model_idx ON ai_decisions (model, created_at DESC);
CREATE INDEX ai_decisions_user_idx ON ai_decisions (user_id, created_at DESC);

CREATE SEQUENCE fraud_case_seq;
CREATE TABLE fraud_cases (
  id            text PRIMARY KEY,
  ref           text NOT NULL UNIQUE,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'escalated', 'closed_fraud', 'closed_ok')),
  priority      text NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  title         text NOT NULL,
  assigned_to   text,
  frozen        boolean NOT NULL DEFAULT false,
  str_ref       text,
  str_filed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  closed_by     text
);
CREATE INDEX fraud_cases_status_idx ON fraud_cases (status, updated_at DESC);
CREATE INDEX fraud_cases_user_idx ON fraud_cases (user_id);

CREATE TABLE fraud_case_events (
  seq         bigserial PRIMARY KEY,
  id          text NOT NULL UNIQUE,
  case_id     text NOT NULL REFERENCES fraud_cases (id) ON DELETE CASCADE,
  actor       text NOT NULL,
  kind        text NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fraud_case_events_case_idx ON fraud_case_events (case_id, seq);

ALTER TABLE risk_alerts ADD COLUMN score int;
ALTER TABLE risk_alerts ADD COLUMN decision_id text;
ALTER TABLE risk_alerts ADD COLUMN case_id text REFERENCES fraud_cases (id) ON DELETE SET NULL;
CREATE INDEX risk_alerts_case_idx ON risk_alerts (case_id);
