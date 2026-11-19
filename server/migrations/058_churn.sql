-- Retention: agent & merchant churn risk (AI governance model 'churn_risk'). Additive only.
-- One score per agent/merchant per Lesotho day. Kept, so the portal can show the trend and check the model's track
-- record (did the ones it called high risk really go quiet?).
CREATE TABLE churn_scores (
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day            date NOT NULL,
  score          int NOT NULL CHECK (score BETWEEN 0 AND 100),
  band           text NOT NULL CHECK (band IN ('high', 'medium', 'low', 'quiet')),
  reasons        jsonb NOT NULL DEFAULT '[]',
  activity       jsonb NOT NULL DEFAULT '{}',
  model_version  int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX churn_scores_day_idx ON churn_scores (day, band);

-- What staff did about it: one current follow-up per agent/merchant.
CREATE TABLE churn_followups (
  user_id     text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('new', 'contacted', 'retained', 'lost')),
  note        text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
