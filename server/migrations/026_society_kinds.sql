-- Mokhatlo kinds: Motšelo (members pay a fixed amount each month) and burial societies live inside Mokhatlo,
-- not as separate mini apps. Additive only; existing societies stay 'society'.
ALTER TABLE societies ADD COLUMN kind text NOT NULL DEFAULT 'society' CHECK (kind IN ('society', 'motselo', 'burial'));
-- What each member pays a month (Maseru calendar month). NULL: members pay what they choose.
ALTER TABLE societies ADD COLUMN contribution_cents bigint CHECK (contribution_cents > 0);
