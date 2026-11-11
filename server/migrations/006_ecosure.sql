-- EcoSure insurance mini app (funeral cover, short-term quotes), served from Moqoqo until the real EcoSure API exists.
-- Additive only. The EcoSure system wallet (users.biller = 'ecosure') is ensured by the seed, like the billers.

-- New ledger kinds: 'ecosure' (premium, payer → EcoSure wallet) and 'claim' (payout, outside → holder's wallet).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('send', 'mpho', 'request', 'bill', 'merchant', 'tap', 'qr', 'cashin', 'cashout', 'float', 'register', 'ecosure', 'claim'));

-- ---------- catalogue ----------

CREATE TABLE ecosure_products (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  line         text NOT NULL CHECK (line IN ('funeral', 'short_term')),
  category     text NOT NULL CHECK (category IN ('funeral', 'motor_vehicle', 'device', 'house_contents', 'house_owners', 'sme')),
  underwriter  text NOT NULL,
  pricing      text NOT NULL CHECK (pricing IN ('fixed', 'quoted')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'retired')),
  sort         integer NOT NULL DEFAULT 0
);

CREATE TABLE ecosure_product_options (
  product_code           text NOT NULL REFERENCES ecosure_products (code) ON DELETE CASCADE,
  label                  text NOT NULL,
  cover                  text CHECK (cover IN ('family', 'single')), -- funeral only; SME options are business sizes
  monthly_premium_cents  bigint NOT NULL CHECK (monthly_premium_cents > 0),
  sort                   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_code, label)
);

CREATE TABLE ecosure_quote_fields (
  product_code  text NOT NULL REFERENCES ecosure_products (code) ON DELETE CASCADE,
  label         text NOT NULL,
  field_type    text NOT NULL CHECK (field_type IN ('text', 'number', 'yes_no', 'choice', 'document')),
  required      boolean NOT NULL DEFAULT true,
  choices       text[] NOT NULL DEFAULT '{}',
  sort          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_code, label)
);

CREATE TABLE ecosure_product_claim_documents (
  product_code  text NOT NULL REFERENCES ecosure_products (code) ON DELETE CASCADE,
  label         text NOT NULL,
  sort          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_code, label)
);

-- Catalogue from EcoSure's BRS (prices still to be confirmed by SEFS), underwritten by LNIG Hollard.
-- NOTE: in the real EcoSure catalogue the short-term products are still drafts until the product team publishes
-- them; they are 'active' here so the whole quote flow can be tried in Moqoqo.
INSERT INTO ecosure_products (code, name, line, category, underwriter, pricing, status, sort) VALUES
  ('FUN-LITE',    'EcoSure Lite',          'funeral',    'funeral',        'LNIG Hollard', 'fixed',  'active', 10),
  ('FUN-BASIC',   'EcoSure Basic',         'funeral',    'funeral',        'LNIG Hollard', 'fixed',  'active', 20),
  ('FUN-STD',     'EcoSure Standard',      'funeral',    'funeral',        'LNIG Hollard', 'fixed',  'active', 30),
  ('FUN-PREM',    'EcoSure Premium',       'funeral',    'funeral',        'LNIG Hollard', 'fixed',  'active', 40),
  ('ST-MOTOR',    'Motor Vehicle',         'short_term', 'motor_vehicle',  'LNIG Hollard', 'quoted', 'active', 110),
  ('ST-DEVICE',   'Device',                'short_term', 'device',         'LNIG Hollard', 'quoted', 'active', 120),
  ('ST-CONTENTS', 'House Contents',        'short_term', 'house_contents', 'LNIG Hollard', 'quoted', 'active', 130),
  ('ST-OWNERS',   'House Owners',          'short_term', 'house_owners',   'LNIG Hollard', 'quoted', 'active', 140),
  ('ST-SME',      'SMEs – Mphatlalatsane', 'short_term', 'sme',            'LNIG Hollard', 'fixed',  'active', 150);

INSERT INTO ecosure_product_options (product_code, label, cover, monthly_premium_cents, sort) VALUES
  ('FUN-LITE',  'Family cover', 'family', 3000, 1),  ('FUN-LITE',  'Single cover', 'single', 2000, 2),
  ('FUN-BASIC', 'Family cover', 'family', 5800, 1),  ('FUN-BASIC', 'Single cover', 'single', 4000, 2),
  ('FUN-STD',   'Family cover', 'family', 8400, 1),  ('FUN-STD',   'Single cover', 'single', 6000, 2),
  ('FUN-PREM',  'Family cover', 'family', 14000, 1), ('FUN-PREM',  'Single cover', 'single', 10000, 2),
  ('ST-SME', 'Small business',  NULL, 56000, 1),
  ('ST-SME', 'Medium business', NULL, 75000, 2),
  ('ST-SME', 'Larger business', NULL, 100000, 3);

INSERT INTO ecosure_quote_fields (product_code, label, field_type, required, choices, sort) VALUES
  ('ST-MOTOR', 'Vehicle description', 'text', true, '{}', 1),
  ('ST-MOTOR', 'Vehicle model', 'text', true, '{}', 2),
  ('ST-MOTOR', 'Registration papers / VAT11', 'document', true, '{}', 3),
  ('ST-MOTOR', 'Use', 'choice', true, ARRAY['Private', 'Commercial'], 4),
  ('ST-MOTOR', 'Is a tracker installed?', 'yes_no', true, '{}', 5),
  ('ST-MOTOR', 'Any previous claims?', 'yes_no', true, '{}', 6),
  ('ST-MOTOR', 'Letter of settlement (if previous claims)', 'document', false, '{}', 7),
  ('ST-DEVICE', 'Purchase invoice', 'document', false, '{}', 1),
  ('ST-DEVICE', 'Device quotation (if there is no invoice)', 'document', false, '{}', 2),
  ('ST-CONTENTS', 'Estimated replacement value (M)', 'number', true, '{}', 1),
  ('ST-OWNERS', 'Property evaluation report', 'document', true, '{}', 1),
  ('ST-SME', 'Nature of the business', 'text', true, '{}', 1),
  ('ST-SME', 'Business licence', 'document', true, '{}', 2),
  ('ST-SME', 'Valid tax clearance certificate', 'document', true, '{}', 3),
  ('ST-SME', 'Company extract (registered companies)', 'document', false, '{}', 4),
  ('ST-SME', 'Director’s national ID or passport', 'document', true, '{}', 5);

INSERT INTO ecosure_product_claim_documents (product_code, label, sort)
SELECT p.code, d.label, d.sort FROM ecosure_products p CROSS JOIN (VALUES
  ('Deceased ID copy', 1),
  ('Death certificate', 2),
  ('Mortuary letter', 3),
  ('Beneficiary’s ID', 4),
  ('Beneficiary’s banking details', 5),
  ('Medical certificate (natural cause)', 6),
  ('Police report (unnatural cause)', 7),
  ('Chief’s letter (undetermined cause)', 8)
) AS d (label, sort) WHERE p.line = 'funeral';

INSERT INTO ecosure_product_claim_documents (product_code, label, sort) VALUES
  ('ST-MOTOR', 'Two repair quotations', 1),
  ('ST-MOTOR', 'Driver’s licence of the driver at the time of the accident', 2),
  ('ST-MOTOR', 'Clear photographs of the vehicle damage', 3),
  ('ST-MOTOR', 'Police report', 4),
  ('ST-MOTOR', 'Third-party driver’s details (if a third party was involved)', 5);

INSERT INTO ecosure_product_claim_documents (product_code, label, sort)
SELECT p.code, d.label, d.sort FROM ecosure_products p CROSS JOIN (VALUES
  ('Police report (theft claims)', 1),
  ('Clear photographs of the damage (damage claims)', 2),
  ('Two quotations for repair or replacement', 3)
) AS d (label, sort) WHERE p.code IN ('ST-DEVICE', 'ST-CONTENTS', 'ST-OWNERS');

-- ---------- policies ----------

CREATE SEQUENCE ecosure_policy_number_seq START 101;
CREATE SEQUENCE ecosure_receipt_seq START 1;
CREATE SEQUENCE ecosure_claim_seq START 1;
CREATE SEQUENCE ecosure_quote_seq START 1;

-- Status is derived on read: cancelled if cancelled_at; active while today <= paid_until; grace for 30 days after; else lapsed.
CREATE TABLE ecosure_policies (
  id                  text PRIMARY KEY,
  number              text NOT NULL UNIQUE DEFAULT ('ES-' || lpad(nextval('ecosure_policy_number_seq')::text, 6, '0')),
  holder_id           text NOT NULL REFERENCES users (id),
  product_code        text NOT NULL REFERENCES ecosure_products (code),
  cover               text NOT NULL CHECK (cover IN ('family', 'single')),
  premium_cents       bigint NOT NULL CHECK (premium_cents > 0),
  id_number           text NOT NULL,
  full_name           text NOT NULL,
  dob                 date NOT NULL,
  gender              text NOT NULL CHECK (gender IN ('female', 'male')),
  beneficiary_name    text,
  beneficiary_msisdn  text,
  paid_until          date NOT NULL,
  cancelled_at        timestamptz,
  sponsor_id          text REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecosure_policies_holder_idx ON ecosure_policies (holder_id, created_at);

CREATE TABLE ecosure_members (
  id            text PRIMARY KEY,
  policy_id     text NOT NULL REFERENCES ecosure_policies (id) ON DELETE CASCADE,
  name          text NOT NULL,
  relationship  text NOT NULL CHECK (relationship IN ('main', 'spouse', 'child', 'parent', 'extended')),
  dob           date,
  removed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecosure_members_policy_idx ON ecosure_members (policy_id);

CREATE TABLE ecosure_payments (
  id              text PRIMARY KEY,
  receipt         text NOT NULL UNIQUE DEFAULT ('RC-' || lpad(nextval('ecosure_receipt_seq')::text, 6, '0')),
  policy_id       text NOT NULL REFERENCES ecosure_policies (id),
  payer_id        text NOT NULL REFERENCES users (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  months          integer NOT NULL CHECK (months > 0),
  transaction_id  text REFERENCES transactions (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecosure_payments_policy_idx ON ecosure_payments (policy_id, created_at);
CREATE INDEX ecosure_payments_payer_idx ON ecosure_payments (payer_id, created_at);

-- ---------- uploads (claim and quote documents) ----------

CREATE TABLE ecosure_uploads (
  id            text PRIMARY KEY,
  owner_id      text NOT NULL REFERENCES users (id),
  file_name     text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256        text NOT NULL,
  content       bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz                  -- set once attached to a claim or quote; unused uploads go after 24 h
);
CREATE INDEX ecosure_uploads_owner_idx ON ecosure_uploads (owner_id);
CREATE INDEX ecosure_uploads_unused_idx ON ecosure_uploads (created_at) WHERE used_at IS NULL;

-- ---------- claims ----------

CREATE TABLE ecosure_claims (
  id              text PRIMARY KEY,
  reference       text NOT NULL UNIQUE DEFAULT ('CLM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ecosure_claim_seq')::text, 5, '0')),
  policy_id       text NOT NULL REFERENCES ecosure_policies (id),
  member_id       text NOT NULL REFERENCES ecosure_members (id),
  date_of_death   date NOT NULL,
  cause           text NOT NULL CHECK (cause IN ('natural', 'unnatural', 'undetermined')),
  status          text NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'documents_verified', 'under_assessment', 'approved', 'rejected')),
  payout_cents    bigint CHECK (payout_cents IS NULL OR payout_cents > 0),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  verified_at     timestamptz,
  assessed_at     timestamptz,
  decided_at      timestamptz,
  transaction_id  text REFERENCES transactions (id)
);
CREATE INDEX ecosure_claims_policy_idx ON ecosure_claims (policy_id);
CREATE INDEX ecosure_claims_status_idx ON ecosure_claims (status, created_at);

CREATE TABLE ecosure_claim_documents (
  claim_id   text NOT NULL REFERENCES ecosure_claims (id) ON DELETE CASCADE,
  label      text NOT NULL,
  upload_id  text NOT NULL REFERENCES ecosure_uploads (id),
  sort       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (claim_id, label)
);

-- ---------- quotes ----------

CREATE TABLE ecosure_quotes (
  id                     text PRIMARY KEY,
  reference              text NOT NULL UNIQUE DEFAULT ('Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ecosure_quote_seq')::text, 6, '0')),
  user_id                text REFERENCES users (id),
  product_code           text NOT NULL REFERENCES ecosure_products (code),
  option_label           text,
  monthly_premium_cents  bigint CHECK (monthly_premium_cents IS NULL OR monthly_premium_cents > 0),
  answers                jsonb NOT NULL DEFAULT '{}',
  contact_name           text,
  msisdn                 text,
  consent                boolean NOT NULL DEFAULT false,
  -- 'expired' is derived on read from expires_at.
  status                 text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'priced', 'accepted', 'expired', 'declined')),
  expires_at             timestamptz,
  priced_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecosure_quotes_user_idx ON ecosure_quotes (user_id, created_at);
CREATE INDEX ecosure_quotes_status_idx ON ecosure_quotes (status, created_at);

CREATE TABLE ecosure_quote_documents (
  quote_id   text NOT NULL REFERENCES ecosure_quotes (id) ON DELETE CASCADE,
  label      text NOT NULL,
  upload_id  text NOT NULL REFERENCES ecosure_uploads (id),
  sort       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (quote_id, label)
);

-- ---------- sponsorships ----------

CREATE TABLE ecosure_sponsorships (
  id          text PRIMARY KEY,
  sponsor_id  text NOT NULL REFERENCES users (id),
  member_id   text NOT NULL REFERENCES users (id), -- the policy holder being sponsored
  policy_id   text NOT NULL REFERENCES ecosure_policies (id),
  status      text NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting', 'active', 'declined', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecosure_sponsorships_sponsor_idx ON ecosure_sponsorships (sponsor_id);
CREATE INDEX ecosure_sponsorships_member_idx ON ecosure_sponsorships (member_id);
-- At most one open (awaiting or active) sponsorship per policy.
CREATE UNIQUE INDEX ecosure_sponsorships_open_idx ON ecosure_sponsorships (policy_id) WHERE status IN ('awaiting', 'active');
