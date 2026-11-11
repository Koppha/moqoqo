-- Friends, message requests, SMS invites and group invites. Additive only.

-- A friend request; accepting makes two friendship rows (one per direction).
CREATE TABLE friend_requests (
  id            text PRIMARY KEY,
  from_user_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CHECK (from_user_id <> to_user_id)
);
CREATE UNIQUE INDEX friend_requests_pending_idx ON friend_requests (from_user_id, to_user_id) WHERE status = 'pending';
CREATE INDEX friend_requests_to_idx ON friend_requests (to_user_id, status);

CREATE TABLE friendships (
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

-- Who may start a chat with this person: everyone, or friends only (others go to Message requests).
ALTER TABLE users ADD COLUMN message_policy text NOT NULL DEFAULT 'everyone' CHECK (message_policy IN ('everyone', 'friends'));

-- A member's view of a chat: NULL (a normal chat), 'pending' (a message request), 'declined' (hidden, no notifications).
ALTER TABLE chat_members ADD COLUMN request_status text CHECK (request_status IN ('pending', 'declined'));

-- SMS invites to numbers not on EcoCash. When the number first signs in, the inviter's friend request is waiting.
CREATE TABLE invites (
  id              text PRIMARY KEY,
  inviter_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  msisdn          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  joined_user_id  text REFERENCES users (id) ON DELETE SET NULL,
  joined_at       timestamptz,
  UNIQUE (inviter_id, msisdn)
);
CREATE INDEX invites_msisdn_idx ON invites (msisdn) WHERE joined_user_id IS NULL;

-- Invitations to groups made in the app; members join when they accept.
CREATE TABLE group_invites (
  id           text PRIMARY KEY,
  chat_id      text NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invited_by   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX group_invites_pending_idx ON group_invites (chat_id, user_id) WHERE status = 'pending';
CREATE INDEX group_invites_user_idx ON group_invites (user_id, status);
