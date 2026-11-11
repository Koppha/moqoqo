-- Maintenance messages written before the rename still say "Moqoqo"; the app is EcoCash Super App. Additive only.
UPDATE maintenance_windows
SET message_en = replace(message_en, 'Moqoqo', 'EcoCash Super App'),
    message_st = replace(message_st, 'Moqoqo', 'EcoCash Super App')
WHERE message_en LIKE '%Moqoqo%' OR message_st LIKE '%Moqoqo%';
