-- Send to many: one PIN, one database transaction, a payment and a chat message per person.
-- Additive only. batch_id ties the payments together, so the velocity rule counts a batch as one payment.

ALTER TABLE transactions ADD COLUMN batch_id text;
CREATE INDEX transactions_batch_idx ON transactions (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE send_batches (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id),
  client_id       text NOT NULL,
  total_cents     bigint NOT NULL CHECK (total_cents > 0),
  recipients      integer NOT NULL CHECK (recipients > 0),
  note            text,
  result          jsonb NOT NULL,         -- replayed when the app retries with the same client id
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
