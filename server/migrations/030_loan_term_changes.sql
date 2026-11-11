-- Changing a society's loan terms takes two: one executive proposes, other executives approve (the proposer counts as
-- one, as with payments), and only then do the terms apply. One proposal waits at a time. Additive only.
CREATE TABLE society_loan_term_changes (
  id            text PRIMARY KEY,
  society_id    text NOT NULL REFERENCES societies (id) ON DELETE CASCADE,
  proposed_by   text NOT NULL REFERENCES users (id),
  enabled       boolean NOT NULL,
  interest_bp   integer NOT NULL CHECK (interest_bp BETWEEN 0 AND 10000),
  max_months    integer NOT NULL CHECK (max_months BETWEEN 1 AND 24),
  max_cents     bigint CHECK (max_cents > 0),
  approved_by   text[] NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'expired')),
  decided_by    text REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  decided_at    timestamptz
);
CREATE INDEX society_loan_term_changes_society_idx ON society_loan_term_changes (society_id, created_at DESC);
