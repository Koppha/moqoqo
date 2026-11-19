-- SIM swap signals from the bound phone itself (the app's SIM watch). Additive only.
-- sim_swaps.source gains 'device': the bound phone saw its EcoCash SIM replaced or taken out. Such a row holds money
-- like a network swap; it is cleared by staff, or by the phone when the same SIM card is back (cleared_by 'phone').
-- sim_swaps.detail: what the phone saw.

ALTER TABLE sim_swaps DROP CONSTRAINT IF EXISTS sim_swaps_source_check;
ALTER TABLE sim_swaps ADD CONSTRAINT sim_swaps_source_check CHECK (source IN ('network', 'simulated', 'device'));
ALTER TABLE sim_swaps ADD COLUMN detail text;
