-- Everything the EcoSure mini app shows about its cover now comes from the server: the funeral packages follow
-- EcoSure's package list (each product is tied to an EcoSure package group, new groups become new packages), and the
-- words around them (taglines, the "most popular" package, Ts&Cs, the call centre number) are set in the portal.
-- Additive only; the values below are what the app had built in, as starting points.

ALTER TABLE ecosure_products
  ADD COLUMN ecosure_group text UNIQUE,
  ADD COLUMN tagline jsonb,
  ADD COLUMN popular boolean NOT NULL DEFAULT false;

UPDATE ecosure_products p SET ecosure_group = v.grp, tagline = jsonb_build_object('en', v.en, 'st', v.st), popular = v.popular
FROM (VALUES
  ('FUN-LITE',  'LITE',     'Essential cover for peace of mind',  'Tšireletso ea motheo bakeng sa khotso ea kelello', false),
  ('FUN-BASIC', 'BASIC',    'More protection for your loved ones', 'Tšireletso e eketsehileng bakeng sa baratuoa ba hau', false),
  ('FUN-STD',   'STANDARD', 'Our most popular cover',              'Tšireletso e ratoang ka ho fetisisa', true),
  ('FUN-PREM',  'PREMIUM',  'Maximum cover for complete security', 'Tšireletso e felletseng ka ho fetisisa', false)
) AS v (code, grp, en, st, popular)
WHERE p.code = v.code;

-- One row: the EcoSure texts staff edit in the portal.
CREATE TABLE ecosure_content (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  terms        jsonb NOT NULL,
  call_centre  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ecosure_content (id, terms, call_centre) VALUES (1, jsonb_build_object(
  'en', 'EcoSure cover is underwritten by LNIG Hollard. Premiums are collected monthly from your EcoCash wallet. Waiting periods apply. [Full Ts&Cs text from SEFS Legal]',
  'st', 'Tšireletso ea EcoSure e tiisoa ke LNIG Hollard. Li-premium li nkoa ka khoeli sepacheng sa hau sa EcoCash. Linako tsa ho emela li sebetsa. [Mongolo o felletseng o tsoa ho SEFS Legal]'
), NULL);
