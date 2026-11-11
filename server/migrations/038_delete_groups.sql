-- Deleting a group hides it for everyone; the chat and its messages stay, as payments point at them. Additive only.
ALTER TABLE chats ADD COLUMN deleted_at timestamptz;
