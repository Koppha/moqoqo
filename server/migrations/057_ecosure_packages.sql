-- EcoSure's live package list (policy manager GET /api/v2/packages?countryCode=LS&category=CUSTOM) now feeds the
-- funeral catalogue: each option keeps EcoSure's package id, cover amount, waiting period and whether a beneficiary
-- is required; the Extended packages are a per-member price on each funeral product. Additive only. The values below
-- are the live list on 2026-11-19, so the catalogue is right even before the first sync (or when EcoSure is down).

ALTER TABLE ecosure_product_options
  ADD COLUMN package_id text,
  ADD COLUMN sum_assured_cents bigint CHECK (sum_assured_cents > 0),
  ADD COLUMN waiting_months integer CHECK (waiting_months >= 0),
  ADD COLUMN beneficiary_required boolean NOT NULL DEFAULT false;

ALTER TABLE ecosure_products
  ADD COLUMN extended_package_id text,
  ADD COLUMN extended_member_premium_cents bigint CHECK (extended_member_premium_cents > 0),
  ADD COLUMN extended_sum_assured_cents bigint CHECK (extended_sum_assured_cents > 0);

-- The last sync with EcoSure (one row).
CREATE TABLE ecosure_catalogue_sync (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  synced_at   timestamptz NOT NULL,
  ok          boolean NOT NULL,
  packages    integer NOT NULL DEFAULT 0,
  updated     integer NOT NULL DEFAULT 0,
  skipped     text[] NOT NULL DEFAULT '{}',
  error       text
);

UPDATE ecosure_product_options o SET package_id = v.pkg, sum_assured_cents = v.sa, waiting_months = v.wait, beneficiary_required = v.ben
FROM (VALUES
  ('FUN-LITE',  'family', 'M0001',  1000000, 0, false), ('FUN-LITE',  'single', 'L0008',  1000000, 3, false),
  ('FUN-BASIC', 'family', 'M0002',  2000000, 0, false), ('FUN-BASIC', 'single', 'L0009',  2000000, 3, true),
  ('FUN-STD',   'family', 'M0003',  3000000, 0, false), ('FUN-STD',   'single', 'L00010', 3000000, 3, true),
  ('FUN-PREM',  'family', 'M0004',  5000000, 0, false), ('FUN-PREM',  'single', 'L00011', 5000000, 3, true)
) AS v (code, cover, pkg, sa, wait, ben)
WHERE o.product_code = v.code AND o.cover = v.cover;

UPDATE ecosure_products p SET extended_package_id = v.pkg, extended_member_premium_cents = v.prem, extended_sum_assured_cents = v.sa
FROM (VALUES
  ('FUN-LITE', 'M0005', 2000, 1000000), ('FUN-BASIC', 'M0006', 4000, 2000000),
  ('FUN-STD',  'M0007', 6000, 3000000), ('FUN-PREM',  'M0008', 10000, 5000000)
) AS v (code, pkg, prem, sa)
WHERE p.code = v.code;
