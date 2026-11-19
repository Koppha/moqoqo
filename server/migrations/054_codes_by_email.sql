-- Sign-in codes by email while travelling (Me › Notifications). Additive only.
-- users.codes_by_email_until: until then, the 6-digit code for setting up a phone goes to the confirmed email address
-- instead of by SMS, and setting up is allowed off Econet's network (abroad: roaming or Wi-Fi). Null = off (default).
ALTER TABLE users ADD COLUMN codes_by_email_until timestamptz;
