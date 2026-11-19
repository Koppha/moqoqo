-- First sign-in on a phone: how the wallet's SIM was matched to it (shared/api.ts SimCheck), and the SIMs it reported.
ALTER TABLE onboarding ADD COLUMN sim_check text;
ALTER TABLE bound_devices ADD COLUMN sim_check text;
ALTER TABLE bound_devices ADD COLUMN sims jsonb;
