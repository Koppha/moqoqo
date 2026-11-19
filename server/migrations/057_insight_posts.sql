-- Spending insights: the EcoCash Assistant posts each person's monthly spending summary once. Additive only.
-- A row claims (person, month) before the message goes out, so two servers never both post it.
CREATE TABLE insight_posts (
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month       text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);
