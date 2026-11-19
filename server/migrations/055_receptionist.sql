-- AI receptionist: how urgent a handed-over request is, and which channel it came in on. Additive only.
-- priority 'urgent': fraud, money lost, SIM swap or account takeover — staff see these first.
-- channel: chat (in-app text), app_voice (talking to the assistant in the app), phone (care line), merchant (a
-- merchant's own receptionist).
ALTER TABLE support_tickets ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal'));
ALTER TABLE support_tickets ADD COLUMN channel text NOT NULL DEFAULT 'chat' CHECK (channel IN ('chat', 'app_voice', 'phone', 'merchant'));
CREATE INDEX support_tickets_priority_idx ON support_tickets (status, priority, created_at);
