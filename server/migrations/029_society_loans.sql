-- Loans from a society (Mokhatlo). The executives set the society's own terms; a member asks, the other executives
-- approve, the society pays out, and the borrower repays into the society. Additive only.

ALTER TABLE societies ADD COLUMN loans_enabled boolean NOT NULL DEFAULT false;
-- Simple interest per month in basis points (1000 = 10% a month).
ALTER TABLE societies ADD COLUMN loan_interest_bp integer NOT NULL DEFAULT 0 CHECK (loan_interest_bp BETWEEN 0 AND 10000);
ALTER TABLE societies ADD COLUMN loan_max_months integer NOT NULL DEFAULT 3 CHECK (loan_max_months BETWEEN 1 AND 24);
ALTER TABLE societies ADD COLUMN loan_max_cents bigint CHECK (loan_max_cents > 0);

CREATE SEQUENCE society_loan_seq START 1;

CREATE TABLE society_loans (
  id              text PRIMARY KEY,
  reference       text NOT NULL UNIQUE DEFAULT ('LN-' || lpad(nextval('society_loan_seq')::text, 6, '0')),
  society_id      text NOT NULL REFERENCES societies (id) ON DELETE CASCADE,
  borrower_id     text NOT NULL REFERENCES users (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  -- The terms when asked, so later changes to the society's settings don't change a loan.
  interest_bp     integer NOT NULL,
  months          integer NOT NULL CHECK (months BETWEEN 1 AND 24),
  total_cents     bigint NOT NULL,
  repaid_cents    bigint NOT NULL DEFAULT 0,
  purpose         text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'repaid', 'rejected', 'expired')),
  rejected_by     text REFERENCES users (id),
  transaction_id  text REFERENCES transactions (id),
  client_id       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  paid_out_at     timestamptz,
  due_at          timestamptz,
  repaid_at       timestamptz,
  -- Reminders already sent: before the due date, and the last overdue one.
  reminded_due    boolean NOT NULL DEFAULT false,
  reminded_late_at timestamptz,
  UNIQUE (borrower_id, client_id)
);
CREATE INDEX society_loans_society_idx ON society_loans (society_id, created_at DESC);
CREATE INDEX society_loans_open_idx ON society_loans (status, due_at);

CREATE TABLE society_loan_approvals (
  loan_id  text NOT NULL REFERENCES society_loans (id) ON DELETE CASCADE,
  user_id  text NOT NULL REFERENCES users (id),
  at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (loan_id, user_id)
);

CREATE TABLE society_loan_repayments (
  id              text PRIMARY KEY,
  loan_id         text NOT NULL REFERENCES society_loans (id) ON DELETE CASCADE,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  transaction_id  text REFERENCES transactions (id),
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX society_loan_repayments_loan_idx ON society_loan_repayments (loan_id, at);
