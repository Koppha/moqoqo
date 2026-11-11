-- Saved bills (accounts at billers, with a nickname), saved recipients, and stop orders: payments the server makes on a
-- set day to a saved bill or recipient, confirmed once with the PIN. Additive only.

CREATE TABLE saved_bills (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id),
  target      text NOT NULL,                 -- 'lec' or 'service:<id>'
  account     text NOT NULL,
  nickname    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target, account)
);
CREATE INDEX saved_bills_user_idx ON saved_bills (user_id, target);

CREATE TABLE saved_recipients (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id),
  contact_id  text NOT NULL REFERENCES users (id),
  nickname    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);

CREATE TABLE stop_orders (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users (id),
  kind           text NOT NULL CHECK (kind IN ('bill', 'send')),
  saved_bill_id  text REFERENCES saved_bills (id) ON DELETE SET NULL,
  recipient_id   text REFERENCES saved_recipients (id) ON DELETE SET NULL,
  label          text NOT NULL,
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  frequency      text NOT NULL CHECK (frequency IN ('monthly', 'weekly')),
  day            integer NOT NULL,
  next_run       date NOT NULL,
  -- The date being paid while it is retried the next day (short of money), so the next one is worked out from it.
  retry_of       date,
  end_date       date,
  remaining      integer,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stop_orders_due_idx ON stop_orders (status, next_run);

CREATE TABLE stop_order_runs (
  id         text PRIMARY KEY,
  order_id   text NOT NULL REFERENCES stop_orders (id) ON DELETE CASCADE,
  due_on     date NOT NULL,
  status     text NOT NULL CHECK (status IN ('paid', 'failed', 'retrying')),
  amount_cents bigint NOT NULL,
  reference  text,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stop_order_runs_order_idx ON stop_order_runs (order_id, created_at DESC);
