-- Expo push tickets waiting for their receipt. Expo keeps receipts for 24 hours and they are ready after about
-- 15 minutes; the receipt says whether FCM/APNs took the message, and DeviceNotRegistered means the phone's token
-- is dead and its device row is removed. Rows are deleted once their receipt is read (or after 24 hours).
CREATE TABLE push_tickets (
  ticket_id        text PRIMARY KEY,
  expo_push_token  text NOT NULL,
  user_id          text REFERENCES users (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tickets_created_idx ON push_tickets (created_at);
