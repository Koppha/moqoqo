-- Who owns an agent or merchant account: the owner's national ID, recorded by EcoCash staff when the business is
-- registered (portal). Only the person whose verified ID matches can add the business to their EcoCash App; the
-- business PIN alone is not enough (staff often know it). Additive, plus removing links that don't meet the rule.

ALTER TABLE users ADD COLUMN owner_id_number text;

DELETE FROM business_links l
 USING users b, users o
 WHERE l.business_id = b.id AND l.owner_id = o.id
   AND (b.owner_id_number IS NULL OR o.id_number IS NULL OR b.owner_id_number <> o.id_number);

DELETE FROM sessions s
 WHERE s.opened_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM business_links l WHERE l.owner_id = s.opened_by AND l.business_id = s.user_id);
