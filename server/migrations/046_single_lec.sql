-- Pay bill › LEC is one thing: the app's LEC screen (meter and amount). The separate "LEC postpaid" biller is switched
-- off; staff can switch it back on in the portal (Services). Additive only.
UPDATE services SET enabled = false WHERE id = 'bill-lec-postpaid';

-- The LEC official account (and its chat) is just "LEC" now. The seed only inserts it when missing.
UPDATE users SET name = 'LEC' WHERE kind = 'system' AND biller = 'lec' AND name = 'LEC Electricity';
