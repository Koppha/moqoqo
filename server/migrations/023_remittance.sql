-- Remittance: send money from the wallet to another country through a remittance partner (mock in
-- src/gateways/remit.ts until the partner is chosen). Additive only. The wallet pays with the existing ledger kinds
-- 'withdraw' (amount) and 'fee', so tier-1 KYC limits ("bank" group) and the risk rules cover remittances too.

CREATE SEQUENCE remittance_seq START 1;

CREATE TABLE remittances (
  id                  text PRIMARY KEY,
  reference           text NOT NULL UNIQUE DEFAULT ('RM-' || lpad(nextval('remittance_seq')::text, 6, '0')),
  user_id             text NOT NULL REFERENCES users (id),
  country             text NOT NULL,                 -- ISO 3166: ZA, SZ …
  currency            text NOT NULL,                 -- ISO 4217: ZAR, SZL …
  payout              text NOT NULL CHECK (payout IN ('mobile', 'bank', 'cash')),
  recipient_name      text NOT NULL,
  recipient_phone     text,
  bank_name           text,
  account_number      text,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),   -- maloti sent
  fee_cents           bigint NOT NULL CHECK (fee_cents >= 0),     -- the wallet pays amount + fee
  rate                numeric(18, 6) NOT NULL CHECK (rate > 0),   -- currency units per M1 when sent
  receive_minor       bigint NOT NULL CHECK (receive_minor >= 0), -- what the recipient gets, in cents of `currency`
  status              text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'completed', 'failed')),
  partner_ref         text,
  pickup_code         text,
  client_id           text NOT NULL,
  transaction_id      text REFERENCES transactions (id),
  fee_transaction_id  text REFERENCES transactions (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX remittances_user_idx ON remittances (user_id, created_at);
CREATE INDEX remittances_created_idx ON remittances (created_at);

-- PLACEHOLDER countries, rates, fees and limits until the remittance partner and tariff are agreed. Admins change them
-- in the portal (PUT /admin/v1/remit); this only sets the starting value. The loti is pegged 1:1 to the rand.
INSERT INTO app_settings (key, value, updated_at) VALUES (
  'remit',
  '{"dailyMax": 10000, "corridors": [
    {"code": "ZA", "country": "South Africa", "currency": "ZAR", "rate": 1, "fee": 15, "feePercent": 1, "max": 5000, "payouts": ["mobile", "bank", "cash"], "enabled": true},
    {"code": "SZ", "country": "Eswatini", "currency": "SZL", "rate": 1, "fee": 15, "feePercent": 1, "max": 5000, "payouts": ["mobile", "bank"], "enabled": true},
    {"code": "BW", "country": "Botswana", "currency": "BWP", "rate": 0.74, "fee": 20, "feePercent": 1.5, "max": 5000, "payouts": ["mobile", "bank"], "enabled": true},
    {"code": "ZW", "country": "Zimbabwe", "currency": "USD", "rate": 0.055, "fee": 20, "feePercent": 2, "max": 5000, "payouts": ["mobile", "cash"], "enabled": true},
    {"code": "MZ", "country": "Mozambique", "currency": "MZN", "rate": 3.5, "fee": 20, "feePercent": 2, "max": 5000, "payouts": ["mobile", "cash"], "enabled": false}
  ]}'::jsonb,
  now()
) ON CONFLICT (key) DO NOTHING;
