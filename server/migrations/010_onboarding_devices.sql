-- Sign-up on a phone (number + EcoCash PIN → Home Affairs ID check → OTP) and binding the wallet to that phone.
-- Additive only.

-- What Home Affairs confirmed the first time the person signed up.
ALTER TABLE users ADD COLUMN id_number text;
ALTER TABLE users ADD COLUMN dob date;
ALTER TABLE users ADD COLUMN gender text CHECK (gender IN ('female', 'male'));
ALTER TABLE users ADD COLUMN id_verified_at timestamptz;
CREATE UNIQUE INDEX users_id_number_idx ON users (id_number) WHERE id_number IS NOT NULL;

-- One row per phone a wallet has been set up on. At most one active (unbound_at IS NULL) per wallet and app.
CREATE TABLE bound_devices (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app             text NOT NULL CHECK (app IN ('customer', 'business')),
  device_id       text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('android', 'ios')),
  model           text NOT NULL,
  os_version      text NOT NULL,
  app_version     text NOT NULL,
  bound_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  unbound_at      timestamptz,
  unbound_reason  text CHECK (unbound_reason IN ('replaced', 'removed_by_staff'))
);
CREATE UNIQUE INDEX bound_devices_active_idx ON bound_devices (user_id, app) WHERE unbound_at IS NULL;
CREATE INDEX bound_devices_user_idx ON bound_devices (user_id, bound_at DESC);

-- Which bound phone a session belongs to (NULL for sessions from before binding, and for tests).
ALTER TABLE sessions ADD COLUMN bound_device_id text REFERENCES bound_devices (id) ON DELETE CASCADE;

-- A sign-up in progress (30 minutes). The OTP is stored hashed.
CREATE TABLE onboarding (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app             text NOT NULL CHECK (app IN ('customer', 'business')),
  device          jsonb NOT NULL,
  network         jsonb NOT NULL,
  step            text NOT NULL DEFAULT 'identity' CHECK (step IN ('identity', 'confirm', 'otp', 'done', 'failed')),
  id_number       text,
  record          jsonb,              -- Home Affairs: { fullName, dob, gender }
  confirm_tries   integer NOT NULL DEFAULT 0,
  otp_hash        text,
  otp_sent_at     timestamptz,
  otp_expires_at  timestamptz,
  otp_tries       integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX onboarding_user_idx ON onboarding (user_id, created_at DESC);
