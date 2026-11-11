-- EcoCash Business as a mini app in EcoCash App: a person links the agent or merchant accounts they run (proving it
-- with that account's number and PIN, once), then opens them from the Business tile without signing in again.
-- A business account stays its own wallet on its own number (the merchant SIM), like a society. Additive only.

CREATE TABLE business_links (
  owner_id     text NOT NULL REFERENCES users (id),
  business_id  text NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, business_id)
);
CREATE INDEX business_links_business_idx ON business_links (business_id);

-- A business session opened from EcoCash App: who opened it, so unlinking ends it.
ALTER TABLE sessions ADD COLUMN opened_by text REFERENCES users (id) ON DELETE CASCADE;
