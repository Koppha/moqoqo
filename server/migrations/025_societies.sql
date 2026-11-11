-- Society (Mekhatlo): group wallets for societies, stokvels and burial societies. Additive only.
-- Each society holds its money in its own system wallet (users.kind = 'system'), so the ledger, KYC and risk rules
-- work unchanged. Payouts from the society need approvalsRequired signatories (the requester counts as one).

CREATE TABLE societies (
  id                  text PRIMARY KEY,
  code                text NOT NULL UNIQUE CHECK (code ~ '^[0-9]{4}$'),
  name                text NOT NULL,
  wallet_user_id      text NOT NULL UNIQUE REFERENCES users (id),
  approvals_required  integer NOT NULL DEFAULT 2 CHECK (approvals_required BETWEEN 1 AND 10),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE society_members (
  society_id  text NOT NULL REFERENCES societies (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users (id),
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'signatory')),
  added_by    text REFERENCES users (id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (society_id, user_id)
);
CREATE INDEX society_members_user_idx ON society_members (user_id);

CREATE SEQUENCE society_transfer_seq START 1;

CREATE TABLE society_transfers (
  id              text PRIMARY KEY,
  reference       text NOT NULL UNIQUE DEFAULT ('SOC-' || lpad(nextval('society_transfer_seq')::text, 6, '0')),
  society_id      text NOT NULL REFERENCES societies (id) ON DELETE CASCADE,
  requested_by    text NOT NULL REFERENCES users (id),
  to_user_id      text NOT NULL REFERENCES users (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  note            text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'expired')),
  rejected_by     text REFERENCES users (id),
  transaction_id  text REFERENCES transactions (id),
  client_id       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  decided_at      timestamptz,
  UNIQUE (requested_by, client_id)
);
CREATE INDEX society_transfers_society_idx ON society_transfers (society_id, created_at DESC);

CREATE TABLE society_approvals (
  transfer_id  text NOT NULL REFERENCES society_transfers (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id),
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transfer_id, user_id)
);
