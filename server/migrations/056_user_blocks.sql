-- People blocking people. Additive only.
-- While a block stands (either way), the two can't message, send money, request money or send friend requests to
-- each other one to one. Groups they share are unaffected. Only customers can be blocked (not merchants or agents).
CREATE TABLE user_blocks (
  blocker_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);
