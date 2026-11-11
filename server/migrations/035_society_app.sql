-- Mekhatlo (Society) as its own app, next to EcoSure: phones are set up and bound per app. Additive only.
ALTER TABLE bound_devices DROP CONSTRAINT IF EXISTS bound_devices_app_check;
ALTER TABLE bound_devices ADD CONSTRAINT bound_devices_app_check CHECK (app IN ('customer', 'business', 'ecosure', 'society'));
ALTER TABLE onboarding DROP CONSTRAINT IF EXISTS onboarding_app_check;
ALTER TABLE onboarding ADD CONSTRAINT onboarding_app_check CHECK (app IN ('customer', 'business', 'ecosure', 'society'));
