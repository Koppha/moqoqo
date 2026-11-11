-- The app is now called "EcoCash App" (was "Moqoqo"). The seed only inserts system accounts when they are missing,
-- so existing databases rename them here. Package ids, the URL scheme and the API stay the same.
UPDATE users SET name = 'EcoCash App', business_name = CASE WHEN business_name IS NULL THEN NULL ELSE 'EcoCash App' END
  WHERE kind = 'system' AND biller IN ('inbox', 'fees') AND name = 'Moqoqo';
UPDATE users SET name = 'EcoCash Assistant', business_name = CASE WHEN business_name IS NULL THEN NULL ELSE 'EcoCash Assistant' END
  WHERE kind = 'system' AND biller = 'assistant' AND name = 'Moqoqo Assistant';
