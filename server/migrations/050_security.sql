-- CBL/LCA DFS Security Guidelines: staff lockout and session expiry, sign-in event log, payment biometrics,
-- customers removing or reporting phones, and terms accepted at setup. Additive only.

ALTER TABLE admins ADD COLUMN failed_logins int NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN locked_until timestamptz;
ALTER TABLE admin_sessions ADD COLUMN last_used_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE auth_events (
  id          text PRIMARY KEY,
  user_id     text REFERENCES users (id) ON DELETE CASCADE,
  admin_id    text REFERENCES admins (id) ON DELETE CASCADE,
  kind        text NOT NULL,
  app         text,
  ip          text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_user_idx ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_admin_idx ON auth_events (admin_id, created_at DESC);

-- Fingerprint/face for payments: a random token the phone keeps behind its biometric prompt; only its hash is here.
CREATE TABLE pay_biometric_keys (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bound_device_id  text REFERENCES bound_devices (id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz
);
CREATE INDEX pay_biometric_keys_user_idx ON pay_biometric_keys (user_id) WHERE revoked_at IS NULL;

ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN terms_version text;

ALTER TABLE bound_devices DROP CONSTRAINT IF EXISTS bound_devices_unbound_reason_check;
ALTER TABLE bound_devices ADD CONSTRAINT bound_devices_unbound_reason_check
  CHECK (unbound_reason IN ('replaced', 'removed_by_staff', 'removed_by_user', 'reported_lost'));
