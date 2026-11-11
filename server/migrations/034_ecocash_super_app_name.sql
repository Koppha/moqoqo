-- The app is now called "EcoCash Super App" (was "EcoCash App"). Existing databases rename the system accounts that
-- carry the app's name (inbox and fees), as 022 did before. Package ids, the URL scheme and the API stay the same.
UPDATE users SET name = 'EcoCash Super App', business_name = CASE WHEN business_name IS NULL THEN NULL ELSE 'EcoCash Super App' END
  WHERE kind = 'system' AND biller IN ('inbox', 'fees') AND name = 'EcoCash App';
