-- Branding uploaded in the portal: the in-app logo, the home-screen icon (used by the next build) and service icons.
-- Additive only. Which logo and icon are in use is stored in app_settings ('branding').

CREATE TABLE assets (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('logo', 'app_icon', 'service_icon')),
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  width         integer NOT NULL,
  height        integer NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  content       bytea NOT NULL,
  uploaded_by   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE services ADD COLUMN image text;
