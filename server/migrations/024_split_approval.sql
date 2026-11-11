-- Split bill per the EcoCash pinless payment flow: each person approves their share once (with their PIN), then it is
-- collected without a PIN, right away and as money arrives, until paid. The money can go to the organiser, another
-- subscriber, or a merchant. Additive only.

-- organiser: shares are paid to the organiser. subscriber: to another wallet. merchant_cover: the organiser paid the
-- merchant in full when creating it and the shares come back to the organiser. merchant_direct: each share goes to
-- the merchant as it is collected.
ALTER TABLE requests ADD COLUMN split_mode text CHECK (split_mode IN ('organiser', 'subscriber', 'merchant_cover', 'merchant_direct'));
-- Who the bill is for (the merchant or the other subscriber); NULL when the organiser receives.
ALTER TABLE requests ADD COLUMN split_payee_id text REFERENCES users (id);
UPDATE requests SET split_mode = 'organiser' WHERE kind = 'split';

-- awaiting: waiting for approval. collecting: approved, still owed. paid. declined. expired: never approved in time.
-- lapsed: the collection deadline passed with money still owed. covered: the organiser took it over.
-- reassigned: moved to another person. cancelled: the split was cancelled.
ALTER TABLE split_shares ADD COLUMN status text NOT NULL DEFAULT 'awaiting'
  CHECK (status IN ('awaiting', 'collecting', 'paid', 'declined', 'expired', 'lapsed', 'covered', 'reassigned', 'cancelled'));
UPDATE split_shares SET status = 'paid' WHERE paid_at IS NOT NULL;
ALTER TABLE split_shares ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE split_shares ADD COLUMN approve_by timestamptz;
ALTER TABLE split_shares ADD COLUMN approved_at timestamptz;
ALTER TABLE split_shares ADD COLUMN collect_until timestamptz;
ALTER TABLE split_shares ADD COLUMN closed_at timestamptz;
ALTER TABLE split_shares ADD COLUMN reminders integer NOT NULL DEFAULT 0;
-- The EcoCash pinless payment payload for this share.
ALTER TABLE split_shares ADD COLUMN payload_id text;
CREATE INDEX split_shares_status_idx ON split_shares (status);

-- PLACEHOLDER limits until ETL confirms them; edited in the portal.
INSERT INTO app_settings (key, value) VALUES ('split', '{
  "approvalHours": 48, "reminderHours": [1, 24], "collectionDays": 30, "maxShare": 500, "maxShareTier1": 200,
  "maxOpenOwed": 1000, "maxParticipants": 20, "balanceFloor": 20, "merchantDirect": true
}'::jsonb) ON CONFLICT (key) DO NOTHING;
