-- EcoSure profiles: the standalone EcoSure app signs in with a PIN the person creates for EcoSure, never the EcoCash
-- PIN (EcoCash approves payments itself). Its own lockout, separate from the wallet PIN's. Additive only.
ALTER TABLE users ADD COLUMN ecosure_pin_hash text;          -- NULL: no EcoSure profile yet
ALTER TABLE users ADD COLUMN ecosure_pin_salt text;
ALTER TABLE users ADD COLUMN ecosure_failed_pins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN ecosure_locked_until timestamptz;

-- A sign-up is either a login on a new phone (PIN first, then ID and SMS code) or creating an EcoSure profile (SMS
-- code first, so only the phone's owner can look up an ID; then ID; then the new PIN).
ALTER TABLE onboarding ADD COLUMN purpose text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'profile'));
ALTER TABLE onboarding DROP CONSTRAINT onboarding_step_check;
ALTER TABLE onboarding ADD CONSTRAINT onboarding_step_check CHECK (step IN ('identity', 'confirm', 'otp', 'pin', 'done', 'failed'));
