-- Cardless ATM withdrawal: the amount + fee are held at once; the code is redeemed at an ATM, or the money comes back.
-- Additive only. Holding and fees go through the system wallets 'atm' (held money) and 'fees'.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('send', 'mpho', 'request', 'bill', 'merchant', 'tap', 'qr', 'cashin', 'cashout', 'float', 'register',
                  'ecosure', 'claim', 'topup', 'withdraw', 'fee', 'service', 'atm', 'atm_refund'));

CREATE SEQUENCE atm_withdrawal_seq START 1;
CREATE TABLE atm_withdrawals (
  id              text PRIMARY KEY,
  reference       text NOT NULL UNIQUE DEFAULT ('ATM-' || lpad(nextval('atm_withdrawal_seq')::text, 6, '0')),
  user_id         text NOT NULL REFERENCES users (id),
  client_id       text NOT NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  fee_cents       bigint NOT NULL CHECK (fee_cents >= 0),
  code_hash       text NOT NULL,
  code            text NOT NULL,          -- shown to the owner while active (mock; a real switch keeps only the hash)
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired', 'cancelled')),
  wrong_tries     integer NOT NULL DEFAULT 0,
  atm             text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  redeemed_at     timestamptz,
  closed_at       timestamptz,
  UNIQUE (user_id, client_id)
);
CREATE INDEX atm_withdrawals_user_idx ON atm_withdrawals (user_id, created_at DESC);
CREATE INDEX atm_withdrawals_active_idx ON atm_withdrawals (expires_at) WHERE status = 'active';

-- PLACEHOLDER fee and maximum, editable in the portal (Fees & limits).
UPDATE app_settings SET value = value || '{"atmFee": 5, "atmMax": 3000}'::jsonb WHERE key = 'tariff';
