-- Mokhatlo applications: a member applies for a new society in the app, ETL approves it in the portal, and the
-- society opens once its Mokhatlo merchant SIM is collected at an Econet shop. That SIM's number becomes the
-- society's wallet number. Additive only.

CREATE SEQUENCE society_application_seq START 1;

CREATE TABLE society_applications (
  id                  text PRIMARY KEY,
  reference           text NOT NULL UNIQUE DEFAULT ('MKH-' || lpad(nextval('society_application_seq')::text, 6, '0')),
  applicant_id        text NOT NULL REFERENCES users (id),
  name                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('society', 'motselo', 'burial')),
  contribution_cents  bigint CHECK (contribution_cents > 0),
  approvals_required  integer NOT NULL CHECK (approvals_required BETWEEN 1 AND 10),
  -- The applicant first, then the other executives they named.
  executive_ids       text[] NOT NULL,
  -- pending → approved (collect the SIM) → active; or rejected / cancelled.
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'active')),
  reason              text,
  decided_by          text REFERENCES admins (id),
  decided_at          timestamptz,
  sim_msisdn          text,
  society_id          text REFERENCES societies (id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX society_applications_applicant_idx ON society_applications (applicant_id, created_at DESC);
CREATE INDEX society_applications_status_idx ON society_applications (status, created_at);

-- PLACEHOLDER wording and limits until ETL confirms them; edited in the portal.
INSERT INTO app_settings (key, value) VALUES ('societyApply', '{
  "enabled": true, "maxOpen": 2,
  "collectInstructions": "Collect your Mokhatlo SIM at any Econet shop within 30 days. All executives come together and bring their ID books, and the society''s constitution or minutes that name its executives."
}'::jsonb) ON CONFLICT (key) DO NOTHING;
