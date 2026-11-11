-- Pay merchant with the customer's one-time payment code (Quick Pay). Additive only.

-- Set when the customer accepts the Payment User Service Agreement; NULL = Quick Pay off.
ALTER TABLE users ADD COLUMN quick_pay_at timestamptz;

-- One-time codes. Only the SHA-256 of the code is stored; a code is spent by setting used_at.
CREATE TABLE pay_codes (
  code_hash   text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX pay_codes_user_idx ON pay_codes (user_id, expires_at);

-- Intents can now be paid by scanning a payment code.
ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS payment_intents_method_check;
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_method_check CHECK (method IN ('qr', 'code', 'tap', 'paycode'));
