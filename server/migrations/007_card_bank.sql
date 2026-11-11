-- Money in and out: card → wallet top-ups and wallet → bank transfers (core wallet features, not mini apps).
-- Additive only. The card gateway and the banks are mocks in src/gateways until the real integrations exist.
-- The "Moqoqo" fees system wallet (users.biller = 'fees') is ensured by the seed, like the billers and EcoSure.

-- New ledger kinds: 'topup' (outside → wallet, from a card), 'withdraw' (wallet → outside, to a bank account)
-- and 'fee' (wallet → Moqoqo fees wallet).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('send', 'mpho', 'request', 'bill', 'merchant', 'tap', 'qr', 'cashin', 'cashout', 'float', 'register',
                  'ecosure', 'claim', 'topup', 'withdraw', 'fee'));

-- ---------- cards ----------
-- Only the gateway's token, brand, last 4 digits and expiry. NEVER the card number (PAN) or the CVV.
CREATE TABLE cards (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users (id),
  gateway_token  text NOT NULL UNIQUE,
  brand          text NOT NULL CHECK (brand IN ('visa', 'mastercard')),
  last4          text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month      integer NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year       integer NOT NULL CHECK (exp_year BETWEEN 2000 AND 2200),
  holder_name    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz
);
CREATE INDEX cards_user_idx ON cards (user_id, created_at) WHERE removed_at IS NULL;

-- ---------- card top-ups ----------
CREATE SEQUENCE card_topup_seq START 1;

CREATE TABLE card_topups (
  id              text PRIMARY KEY,
  reference       text NOT NULL UNIQUE DEFAULT ('TU-' || lpad(nextval('card_topup_seq')::text, 6, '0')),
  user_id         text NOT NULL REFERENCES users (id),
  card_id         text NOT NULL REFERENCES cards (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),   -- credited to the wallet
  fee_cents       bigint NOT NULL CHECK (fee_cents >= 0),     -- the card is charged amount + fee
  -- 'expired' is also derived on read from expires_at while still pending_otp.
  status          text NOT NULL DEFAULT 'pending_otp' CHECK (status IN ('pending_otp', 'completed', 'failed', 'expired')),
  otp_attempts    integer NOT NULL DEFAULT 0,
  failure_reason  text,
  gateway_ref     text,
  client_id       text NOT NULL,
  transaction_id  text REFERENCES transactions (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  UNIQUE (user_id, client_id)
);
CREATE INDEX card_topups_user_idx ON card_topups (user_id, created_at);

-- ---------- bank accounts (saved beneficiaries) ----------
CREATE TABLE bank_accounts (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id),
  bank_code       text NOT NULL,
  account_number  text NOT NULL,
  account_name    text NOT NULL,   -- as the bank returned it, never typed by the customer
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz
);
CREATE UNIQUE INDEX bank_accounts_active_idx ON bank_accounts (user_id, bank_code, account_number) WHERE removed_at IS NULL;

-- ---------- bank transfers ----------
CREATE SEQUENCE bank_transfer_seq START 1;

CREATE TABLE bank_transfers (
  id                  text PRIMARY KEY,
  reference           text NOT NULL UNIQUE DEFAULT ('BT-' || lpad(nextval('bank_transfer_seq')::text, 6, '0')),
  user_id             text NOT NULL REFERENCES users (id),
  bank_code           text NOT NULL,
  account_number      text NOT NULL,
  account_name        text NOT NULL,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),   -- to the bank account
  fee_cents           bigint NOT NULL CHECK (fee_cents >= 0),     -- the wallet pays amount + fee
  status              text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'completed', 'failed')),
  bank_ref            text,
  client_id           text NOT NULL,
  transaction_id      text REFERENCES transactions (id),
  fee_transaction_id  text REFERENCES transactions (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX bank_transfers_user_idx ON bank_transfers (user_id, created_at);

-- ---------- tariff ----------
-- PLACEHOLDER fees and limits (maloti) until the real tariff is known. Admins change them in the portal
-- (PUT /admin/v1/tariff); this only sets the starting value.
INSERT INTO app_settings (key, value, updated_at) VALUES (
  'tariff',
  '{"cardTopupFeePercent": 2, "cardTopupFeeMin": 1, "cardTopupMax": 5000, "bankTransferFee": 10, "bankTransferMax": 10000, "dailyMax": 20000}'::jsonb,
  now()
) ON CONFLICT (key) DO NOTHING;
