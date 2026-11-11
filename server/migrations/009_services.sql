-- Services defined in the portal (form builder): Send money to other networks, airtime, bundles, self-service requests.
-- Additive only. The starter services below use PLACEHOLDER fields, fees and limits until ETL confirms each partner's
-- real parameters; staff change them in the portal (Services).

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('send', 'mpho', 'request', 'bill', 'merchant', 'tap', 'qr', 'cashin', 'cashout', 'float', 'register',
                  'ecosure', 'claim', 'topup', 'withdraw', 'fee', 'service'));

CREATE TABLE services (
  id            text PRIMARY KEY,
  code          text NOT NULL,
  name          jsonb NOT NULL,               -- { en, st }
  description   jsonb NOT NULL,
  icon          text NOT NULL,
  color         text NOT NULL,
  placement     text NOT NULL CHECK (placement IN ('send', 'services', 'me')),
  sort          integer NOT NULL DEFAULT 0,
  enabled       boolean NOT NULL DEFAULT true,
  executor      text NOT NULL CHECK (executor IN ('ecocash_transfer', 'airtime', 'bundle', 'request')),
  fields        jsonb NOT NULL,
  fee           jsonb NOT NULL,
  limits        jsonb NOT NULL,
  confirm_name  boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE service_request_seq START 1;
CREATE TABLE service_requests (
  id            text PRIMARY KEY,
  reference     text NOT NULL UNIQUE,
  user_id       text NOT NULL REFERENCES users (id),
  service_id    text REFERENCES services (id) ON DELETE SET NULL,
  service_name  jsonb NOT NULL,
  lines         jsonb NOT NULL,               -- [{ label, value }] as the customer saw them
  files         jsonb NOT NULL DEFAULT '[]',  -- [{ key, label, uploadId }]
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note          text,
  decided_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_requests_user_idx ON service_requests (user_id, created_at DESC);
CREATE INDEX service_requests_status_idx ON service_requests (status, created_at DESC);

-- One row per submitted form, so a retried submit (same clientId) returns the first result.
CREATE TABLE service_submissions (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id),
  client_id       text NOT NULL,
  service_id      text NOT NULL,
  reference       text NOT NULL,
  amount_cents    bigint,
  fee_cents       bigint,
  transaction_id  text,
  request_id      text,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

INSERT INTO services (id, code, name, description, icon, color, placement, sort, enabled, executor, fields, fee, limits, confirm_name) VALUES
('svc-mpesa', 'MPESA',
 '{"en":"M-Pesa","st":"M-Pesa"}', '{"en":"Send to a Vodacom M-Pesa number","st":"Romela nomorong ea Vodacom M-Pesa"}',
 'phone-portrait', '#E60000', 'send', 20, true, 'ecocash_transfer',
 '[{"key":"mpesa_number","type":"phone","label":{"en":"M-Pesa number","st":"Nomoro ea M-Pesa"},"required":true,"networks":["vodacom"]},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":1,"max":5000},
   {"key":"reference","type":"text","label":{"en":"Reference","st":"Tšupiso"},"required":false,"maxLength":30}]',
 '{"fixed":3,"percent":0}', '{"min":1,"max":5000}', true),
('svc-cpay', 'CPAY',
 '{"en":"C-Pay","st":"C-Pay"}', '{"en":"Send to a C-Pay account","st":"Romela akhaonteng ea C-Pay"}',
 'card', '#0EA5E9', 'send', 30, true, 'ecocash_transfer',
 '[{"key":"cpay_account","type":"text","label":{"en":"C-Pay account number","st":"Nomoro ea akhaonte ea C-Pay"},"required":true,"pattern":"\\d{6,12}","patternMessage":{"en":"6 to 12 digits","st":"Linomoro tse 6 ho isa ho 12"}},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":1,"max":5000}]',
 '{"fixed":3,"percent":0}', '{"min":1,"max":5000}', true),
('svc-khetsi', 'KHETSI',
 '{"en":"Khetsi","st":"Khetsi"}', '{"en":"Send to a Khetsi account","st":"Romela akhaonteng ea Khetsi"}',
 'wallet', '#16A34A', 'send', 40, true, 'ecocash_transfer',
 '[{"key":"khetsi_account","type":"text","label":{"en":"Khetsi account number","st":"Nomoro ea akhaonte ea Khetsi"},"required":true,"pattern":"\\d{6,12}","patternMessage":{"en":"6 to 12 digits","st":"Linomoro tse 6 ho isa ho 12"}},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":1,"max":5000}]',
 '{"fixed":3,"percent":0}', '{"min":1,"max":5000}', true),
('svc-mywallet', 'MYWALLET',
 '{"en":"My Wallet","st":"Sepache sa ka"}', '{"en":"Fields to be defined in the portal","st":"Masimo a tla hlalosoa portal"}',
 'albums', '#7C3AED', 'send', 50, false, 'ecocash_transfer',
 '[{"key":"wallet_number","type":"text","label":{"en":"Wallet number","st":"Nomoro ea sepache"},"required":true,"maxLength":20},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":1,"max":5000}]',
 '{"fixed":0,"percent":0}', '{"min":1,"max":5000}', false),
('svc-airtime', 'AIRTIME',
 '{"en":"Airtime","st":"Airtime"}', '{"en":"Econet airtime for you or anyone","st":"Airtime ea Econet bakeng sa hau kapa e mong"}',
 'call', '#16A34A', 'services', 10, true, 'airtime',
 '[{"key":"number","type":"phone","label":{"en":"Econet number","st":"Nomoro ea Econet"},"required":true,"networks":["econet"],"ownNumber":true},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":2,"max":1000}]',
 '{"fixed":0,"percent":0}', '{"min":2,"max":1000}', false),
('svc-bundles', 'BUNDLE',
 '{"en":"Bundles","st":"Li-bundle"}', '{"en":"Econet data and voice bundles","st":"Li-bundle tsa data le mehala tsa Econet"}',
 'cellular', '#2563EB', 'services', 20, true, 'bundle',
 '[{"key":"number","type":"phone","label":{"en":"Econet number","st":"Nomoro ea Econet"},"required":true,"networks":["econet"],"ownNumber":true},
   {"key":"bundle","type":"select","label":{"en":"Bundle","st":"Bundle"},"required":true,"options":[
     {"value":"D100MB","label":{"en":"Daily 100 MB","st":"Letsatsi 100 MB"},"amount":5},
     {"value":"W1GB","label":{"en":"Weekly 1 GB","st":"Beke 1 GB"},"amount":30},
     {"value":"M5GB","label":{"en":"Monthly 5 GB","st":"Khoeli 5 GB"},"amount":120},
     {"value":"M100MIN","label":{"en":"Monthly 100 minutes","st":"Khoeli metsotso e 100"},"amount":60}]}]',
 '{"fixed":0,"percent":0}', '{"min":1,"max":1000}', false),
('svc-kyc', 'KYC',
 '{"en":"Update KYC","st":"Ntlafatsa KYC"}', '{"en":"Send your ID to raise your wallet limits","st":"Romela ID ea hau ho phahamisa meeli ea sepache"}',
 'id-card', '#5B2C9F', 'me', 10, true, 'request',
 '[{"key":"id_type","type":"select","label":{"en":"Document","st":"Tokomane"},"required":true,"options":[
     {"value":"national_id","label":{"en":"National ID","st":"ID ea naha"}},{"value":"passport","label":{"en":"Passport","st":"Phasepoto"}}]},
   {"key":"id_number","type":"text","label":{"en":"ID or passport number","st":"Nomoro ea ID kapa phasepoto"},"required":true,"minLength":5,"maxLength":20},
   {"key":"id_photo","type":"image","label":{"en":"Photo of the document","st":"Foto ea tokomane"},"required":true},
   {"key":"selfie","type":"image","label":{"en":"Selfie holding the document","st":"Selfie u tšoere tokomane"},"required":true},
   {"key":"address","type":"text","label":{"en":"Home address","st":"Aterese ea lehae"},"required":true,"maxLength":120}]',
 '{"fixed":0,"percent":0}', '{"min":0,"max":0}', false);
