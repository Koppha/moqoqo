-- Home screen, news & offers and in-app messages, controlled from the portal. Additive only.

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('logo', 'app_icon', 'service_icon', 'banner'));

CREATE TABLE offers (
  id          text PRIMARY KEY,
  title       jsonb NOT NULL,
  body        jsonb NOT NULL,
  cta         jsonb NOT NULL,
  image       text,
  color       text NOT NULL,
  target      text,
  placement   text NOT NULL CHECK (placement IN ('home', 'news', 'both')),
  audience    text NOT NULL CHECK (audience IN ('all', 'customers', 'business', 'tier1', 'tier2')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  sort        integer NOT NULL DEFAULT 100,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE broadcasts (
  id          text PRIMARY KEY,
  text        jsonb NOT NULL,
  audience    text NOT NULL,
  sms         boolean NOT NULL,
  recipients  integer NOT NULL,
  sent_by     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Starter banners (were built into the app): EcoSure funeral cover and short-term insurance.
INSERT INTO offers (id, title, body, cta, color, target, placement, audience, sort) VALUES
('offer-funeral', '{"en":"EcoSure funeral cover","st":"Inshorense ea lepato ea EcoSure"}',
 '{"en":"Cover your whole family from M30 a month","st":"Sireletsa lelapa lohle ho tloha ho M30 ka khoeli"}',
 '{"en":"Open EcoSure","st":"Bula EcoSure"}', '#7A4CF0', 'ecosure_funeral', 'both', 'customers', 10),
('offer-short-term', '{"en":"Insure your car, phone and home","st":"Inshora koloi, fono le ntlo ea hau"}',
 '{"en":"EcoSure short-term cover: get a quote in minutes","st":"EcoSure ea nako e khutšoane: fumana tefo ka metsotso"}',
 '{"en":"Get a quote","st":"Fumana tefo"}', '#0EA5E9', 'ecosure_short_term', 'both', 'customers', 20);

INSERT INTO app_settings (key, value) VALUES ('homeLayout',
 '{"sections":[{"key":"offers","visible":true},{"key":"services","visible":true},{"key":"requests","visible":true},{"key":"transactions","visible":true}]}')
ON CONFLICT (key) DO NOTHING;
