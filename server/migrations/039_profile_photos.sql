-- Profile pictures: a person's photo, stored like the portal's pictures (served by an id nobody can guess). Additive only.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('logo', 'app_icon', 'service_icon', 'banner', 'profile_photo'));
ALTER TABLE users ADD COLUMN photo_id text REFERENCES assets (id) ON DELETE SET NULL;
