-- Split bill: a request in a chat where each participant owes their own share. Additive only.

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_kind_check;
ALTER TABLE requests ADD CONSTRAINT requests_kind_check CHECK (kind IN ('money', 'bill', 'cashout', 'merchant', 'split'));
-- equal: the total divided evenly; specific: the organiser set each share; enter: each member types their own.
ALTER TABLE requests ADD COLUMN split_method text CHECK (split_method IN ('equal', 'specific', 'enter'));
-- "Members enter amount" may have no total, and members may pay more than it: relax both checks for splits only.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_amount_cents_check;
ALTER TABLE requests ADD CONSTRAINT requests_amount_cents_check CHECK (amount_cents > 0 OR kind = 'split');
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_check;
ALTER TABLE requests ADD CONSTRAINT requests_check CHECK (paid_cents <= amount_cents OR kind = 'split');

CREATE TABLE split_shares (
  message_id    text NOT NULL REFERENCES requests (message_id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users (id),
  position      integer NOT NULL,
  amount_cents  bigint CHECK (amount_cents IS NULL OR amount_cents > 0), -- NULL: the member enters it when paying
  paid_cents    bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  paid_at       timestamptz,                                           -- the organiser's own share starts paid
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX split_shares_user_idx ON split_shares (user_id);
