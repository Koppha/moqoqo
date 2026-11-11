-- Donate: anyone creates a cause (title, story, target), shares its link or posts it in a chat, and people give from
-- their wallets. Each cause holds its money in its own system wallet (like a society), so every movement goes
-- through the ledger and staff can suspend a cause in the portal. The organiser withdraws to their own wallet.
-- Additive only.

CREATE TABLE causes (
  id              text PRIMARY KEY,
  code            text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6}$'),
  organiser_id    text NOT NULL REFERENCES users (id),
  wallet_user_id  text NOT NULL UNIQUE REFERENCES users (id),
  title           text NOT NULL,
  description     text NOT NULL,
  target_cents    bigint NOT NULL CHECK (target_cents > 0),
  raised_cents    bigint NOT NULL DEFAULT 0,
  donor_count     integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'suspended')),
  status_reason   text,
  ends_at         timestamptz,
  target_told     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX causes_organiser_idx ON causes (organiser_id, created_at DESC);

CREATE TABLE donations (
  id              text PRIMARY KEY,
  cause_id        text NOT NULL REFERENCES causes (id) ON DELETE CASCADE,
  donor_id        text NOT NULL REFERENCES users (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  note            text,
  anonymous       boolean NOT NULL DEFAULT false,
  transaction_id  text REFERENCES transactions (id),
  client_id       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (donor_id, client_id)
);
CREATE INDEX donations_cause_idx ON donations (cause_id, created_at DESC);
CREATE INDEX donations_donor_idx ON donations (donor_id, created_at DESC);

-- A cause shared in a chat shows as a card with its live progress.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('text', 'money', 'mpho', 'request', 'receipt', 'system', 'action', 'cause'));
ALTER TABLE messages ADD COLUMN cause_id text REFERENCES causes (id);

-- PLACEHOLDER limits until ETL confirms them; edited in the portal.
INSERT INTO app_settings (key, value) VALUES ('donate', '{
  "enabled": true, "minKycTier": 2, "maxTarget": 50000, "maxOpenPerUser": 3
}'::jsonb) ON CONFLICT (key) DO NOTHING;
