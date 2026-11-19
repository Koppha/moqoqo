-- Channel map: where staff placed an agent or merchant, for the portal's map. Additive only.
-- Staff-only (the app's Find us still shows Places). Without a row, the map falls back to the wallet's Find us place.
CREATE TABLE channel_locations (
  user_id     text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  address     text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
