-- The standalone EcoSure app signs in like the other two apps. It has its own bound phone: Android gives each app
-- its own device id, so sharing the customer app's binding would unbind Moqoqo on the same phone. Additive only.
ALTER TABLE bound_devices DROP CONSTRAINT bound_devices_app_check;
ALTER TABLE bound_devices ADD CONSTRAINT bound_devices_app_check CHECK (app IN ('customer', 'business', 'ecosure'));
ALTER TABLE onboarding DROP CONSTRAINT onboarding_app_check;
ALTER TABLE onboarding ADD CONSTRAINT onboarding_app_check CHECK (app IN ('customer', 'business', 'ecosure'));
