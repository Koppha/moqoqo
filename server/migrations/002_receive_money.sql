-- Receive money: payment intents (QR / 6-digit code / NFC tap), static merchant QR and NFC tags.
-- Additive only, so an existing database upgrades in place.

-- New ledger kind 'qr' (QR or code payments to merchants).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('send', 'mpho', 'request', 'bill', 'merchant', 'tap', 'qr', 'cashin', 'cashout', 'float', 'register'));

CREATE TABLE payment_intents (
  id              text PRIMARY KEY,
  code            text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  merchant_id     text NOT NULL REFERENCES users (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  note            text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled', 'expired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  paid_by         text REFERENCES users (id),
  method          text CHECK (method IN ('qr', 'code', 'tap')),
  transaction_id  text REFERENCES transactions (id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Codes are unique among open intents (expired ones are swept to 'expired' before new codes are issued).
CREATE UNIQUE INDEX payment_intents_open_code_idx ON payment_intents (code) WHERE status = 'open';
CREATE INDEX payment_intents_merchant_idx ON payment_intents (merchant_id, created_at);
CREATE INDEX payment_intents_open_expiry_idx ON payment_intents (expires_at) WHERE status = 'open';

-- NFC cards/stickers linked to a wallet. tag_id is the UID as uppercase hex.
CREATE TABLE nfc_tags (
  id          text PRIMARY KEY,
  tag_id      text NOT NULL UNIQUE CHECK (tag_id ~ '^[0-9A-F]{8,20}$'),
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nfc_tags_user_idx ON nfc_tags (user_id);

-- Demo sticker for Lerato on databases that already hold the demo seed (fresh databases get it from the seed).
INSERT INTO nfc_tags (id, tag_id, user_id, label)
SELECT gen_random_uuid()::text, '04A2246A8B6D80', u.id, 'EcoCash sticker'
FROM users u WHERE u.msisdn = '+26662000021'
ON CONFLICT (tag_id) DO NOTHING;
