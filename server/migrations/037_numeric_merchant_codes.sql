-- Merchant codes are plain numbers of any length (as on EcoCash), not MRC-0001 / TAXI-0042.
UPDATE users SET code = '1001' WHERE code = 'MRC-0001';
UPDATE users SET code = '1002' WHERE code = 'MRC-0002';
UPDATE users SET code = '1042' WHERE code = 'TAXI-0042';
-- Merchants added from the portal before this: MRC-0003 → 1003, and so on.
UPDATE users SET code = (1000 + substring(code from 5)::int)::text WHERE role = 'merchant' AND code ~ '^MRC-[0-9]+$';
