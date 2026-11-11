-- Places on the map (agents, merchants, ATMs; managed in the portal) and app feedback. Additive only.

CREATE TABLE places (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('agent', 'merchant', 'atm')),
  name        text NOT NULL,
  address     text NOT NULL,
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  hours       text,
  phone       text,
  code        text,
  enabled     boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_enabled_idx ON places (enabled, kind);

-- Starter places around Maseru (demo; staff edit or remove them in the portal).
INSERT INTO places (id, kind, name, address, lat, lng, hours, phone, code) VALUES
('place-agent-habia', 'agent', 'Ha Abia Agent', 'Main Road, Ha Abia, Maseru', -29.3369, 27.4995, 'Mon–Sat 07:30–19:00', '+26662777001', 'AGENT-0101'),
('place-agent-kingsway', 'agent', 'EcoCash Shop Kingsway', 'Kingsway, next to Pioneer Mall, Maseru', -29.3175, 27.4851, 'Mon–Fri 08:00–17:00, Sat 08:00–13:00', '199', NULL),
('place-agent-lithoteng', 'agent', 'Lithoteng Cash Point', 'Lithoteng Main Road, Maseru', -29.3487, 27.5149, 'Every day 07:00–20:00', NULL, NULL),
('place-merchant-cafe', 'merchant', 'Ha Abia Cafe', 'Ha Abia shops, Maseru', -29.3352, 27.5012, 'Every day 06:30–21:00', '+26662888001', '1001'),
('place-merchant-salon', 'merchant', 'Lerato''s Salon', 'Maseru Mall, Maseru', -29.3016, 27.5132, 'Mon–Sat 09:00–18:00', '+26662888021', '1002'),
('place-atm-pioneer', 'atm', 'EcoCash ATM Pioneer Mall', 'Pioneer Mall, Pioneer Road, Maseru', -29.3226, 27.4993, '24 hours', NULL, NULL),
('place-atm-maserumall', 'atm', 'EcoCash ATM Maseru Mall', 'Maseru Mall, Maseru', -29.3008, 27.5140, '24 hours', NULL, NULL),
('place-atm-roma', 'atm', 'EcoCash ATM Roma', 'Roma Campus gate, Roma', -29.4469, 27.7186, '24 hours', NULL, NULL);

CREATE TABLE feedback (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id),
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text         text,
  app          text NOT NULL,
  app_version  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_created_idx ON feedback (created_at DESC);
