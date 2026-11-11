-- Usernames: chosen by the person, used to sign in and to be found by others. Unique regardless of case.
ALTER TABLE users ADD COLUMN username text CHECK (username ~ '^[a-z][a-z0-9._]{2,19}$');
CREATE UNIQUE INDEX users_username_idx ON users (username) WHERE username IS NOT NULL;
