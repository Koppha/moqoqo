-- SIM swap detection. Additive only.
-- sim_swaps: each time a number moved to a new SIM, as Econet reported it (webhook or lookup) or as staff simulated
-- it for testing. users.sim_swap_cleared_at: staff checked the owner in person after a swap, which lifts the hold
-- for swaps up to that time.

CREATE TABLE sim_swaps (
  id            text PRIMARY KEY,
  msisdn        text NOT NULL,
  user_id       text REFERENCES users (id),
  swapped_at    timestamptz NOT NULL,
  source        text NOT NULL CHECK (source IN ('network', 'simulated')),
  received_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at    timestamptz,
  cleared_by    text,
  cleared_note  text
);
CREATE UNIQUE INDEX sim_swaps_msisdn_at_idx ON sim_swaps (msisdn, swapped_at);
CREATE INDEX sim_swaps_user_idx ON sim_swaps (user_id, swapped_at DESC);

ALTER TABLE users ADD COLUMN sim_swap_cleared_at timestamptz;
