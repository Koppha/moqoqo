-- Pay bill: categories of billers, each biller a portal service with the new 'bill' executor (pay a biller through
-- EcoCash: account or policy number and an amount). And an optional app PIN, apart from the EcoCash wallet PIN.
-- Additive only. The billers below are added on behalf of the portal with PLACEHOLDER fields, fees and limits until
-- ETL confirms each one's real details; staff edit, hide, remove and add billers and categories in the portal.

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_executor_check;
ALTER TABLE services ADD CONSTRAINT services_executor_check CHECK (executor IN ('ecocash_transfer', 'airtime', 'bundle', 'request', 'bill'));
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_placement_check;
ALTER TABLE services ADD CONSTRAINT services_placement_check CHECK (placement IN ('send', 'services', 'me', 'bills'));
-- The Pay bill category a service is listed under (a service elsewhere, like Airtime, can be in one too).
ALTER TABLE services ADD COLUMN category text;

CREATE TABLE bill_categories (
  id          text PRIMARY KEY,
  name        jsonb NOT NULL,              -- { en, st }
  icon        text NOT NULL,
  color       text NOT NULL,
  image       text,                        -- an uploaded logo (/v1/assets/<id>) shown instead of the icon
  sort        integer NOT NULL DEFAULT 0,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bill_categories (id, name, icon, color, sort) VALUES
('econet', '{"en":"Econet","st":"Econet"}', 'phone-portrait', '#0047BB', 10),
('lec', '{"en":"LEC","st":"LEC"}', 'flash', '#F59E0B', 20),
('multichoice', '{"en":"MultiChoice","st":"MultiChoice"}', 'tv', '#0E7AC4', 30),
('wasco', '{"en":"WASCO","st":"WASCO"}', 'water', '#0EA5E9', 40),
('insurance', '{"en":"Insurance","st":"Inshorense"}', 'shield-checkmark', '#5B2FD1', 50),
('financial', '{"en":"Financial","st":"Lichelete"}', 'business', '#0F766E', 60),
('utility', '{"en":"Utility","st":"Lits''ebeletso"}', 'construct', '#6B7280', 70);

-- Airtime and Bundles stay where they are and are also listed under Econet.
UPDATE services SET category = 'econet' WHERE code IN ('AIRTIME', 'BUNDLE');

-- One shape for every biller here: the account (or policy, smartcard, member) number and an amount.
CREATE FUNCTION pg_temp.biller_fields(label_en text, label_st text, hint_en text, hint_st text, min_len int, max_len int) RETURNS jsonb AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('key', 'account', 'type', 'text', 'label', jsonb_build_object('en', label_en, 'st', label_st),
      'hint', jsonb_build_object('en', hint_en, 'st', hint_st), 'required', true, 'minLength', min_len, 'maxLength', max_len),
    jsonb_build_object('key', 'amount', 'type', 'amount', 'label', jsonb_build_object('en', 'Amount', 'st', 'Chelete'), 'required', true, 'min', 5, 'max', 20000)
  )
$$ LANGUAGE sql;

INSERT INTO services (id, code, name, description, icon, color, placement, sort, enabled, executor, fields, fee, limits, confirm_name, category) VALUES
-- Econet
('bill-econet-postpaid', 'ECONET_POSTPAID', '{"en":"Econet postpaid","st":"Econet postpaid"}', '{"en":"Pay your Econet contract bill","st":"Lefa tefo ea konteraka ea Econet"}',
 'phone-portrait', '#0047BB', 'bills', 30, true, 'bill',
 pg_temp.biller_fields('Account number', 'Nomoro ea akhaonto', 'On your Econet bill', 'Ho tefo ea hau ea Econet', 6, 20), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'econet'),
-- LEC (prepaid tokens are the app's own LEC screen, shown first)
('bill-lec-postpaid', 'LEC_POSTPAID', '{"en":"LEC postpaid","st":"LEC postpaid"}', '{"en":"Pay an LEC electricity account","st":"Lefa akhaonto ea motlakase ea LEC"}',
 'flash', '#F59E0B', 'bills', 20, true, 'bill',
 pg_temp.biller_fields('Account number', 'Nomoro ea akhaonto', 'On your LEC bill', 'Ho tefo ea hau ea LEC', 6, 20), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'lec'),
-- MultiChoice
('bill-dstv', 'DSTV', '{"en":"DStv","st":"DStv"}', '{"en":"Pay your DStv subscription","st":"Lefa peeletso ea DStv"}',
 'tv', '#0E7AC4', 'bills', 10, true, 'bill',
 pg_temp.biller_fields('Smartcard or account number', 'Nomoro ea smartcard kapa akhaonto', '10 digits, on the decoder or the bill', 'Linomoro tse 10, ho decoder kapa tefong', 8, 12), '{"fixed":0,"percent":0}', '{"min":5,"max":5000}', true, 'multichoice'),
('bill-gotv', 'GOTV', '{"en":"GOtv","st":"GOtv"}', '{"en":"Pay your GOtv subscription","st":"Lefa peeletso ea GOtv"}',
 'tv', '#16A34A', 'bills', 20, true, 'bill',
 pg_temp.biller_fields('IUC number', 'Nomoro ea IUC', '10 digits, on the decoder', 'Linomoro tse 10, ho decoder', 8, 12), '{"fixed":0,"percent":0}', '{"min":5,"max":5000}', true, 'multichoice'),
-- WASCO
('bill-wasco', 'WASCO', '{"en":"WASCO water","st":"Metsi a WASCO"}', '{"en":"Pay your water account","st":"Lefa akhaonto ea metsi"}',
 'water', '#0EA5E9', 'bills', 10, true, 'bill',
 pg_temp.biller_fields('Account number', 'Nomoro ea akhaonto', 'On your WASCO bill', 'Ho tefo ea hau ea WASCO', 4, 20), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'wasco'),
-- Insurance
('bill-lesotho-funeral', 'LESOTHO_FUNERAL', '{"en":"Lesotho Funeral","st":"Lesotho Funeral"}', '{"en":"Funeral cover premium","st":"Tefo ea inshorense ea lepato"}',
 'shield-checkmark', '#5B2FD1', 'bills', 10, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-alliance', 'ALLIANCE', '{"en":"Alliance","st":"Alliance"}', '{"en":"Insurance premium","st":"Tefo ea inshorense"}',
 'shield-checkmark', '#1D4ED8', 'bills', 20, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-mamothe-funeral', 'MAMOTHE_FUNERAL', '{"en":"Mamothe Funeral","st":"Mamothe Funeral"}', '{"en":"Funeral cover premium","st":"Tefo ea inshorense ea lepato"}',
 'shield-checkmark', '#7C3AED', 'bills', 30, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-sentabale-funeral', 'SENTABALE_FUNERAL', '{"en":"Sentabale Funeral","st":"Sentabale Funeral"}', '{"en":"Funeral cover premium","st":"Tefo ea inshorense ea lepato"}',
 'shield-checkmark', '#0F766E', 'bills', 40, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-gl-funeral', 'GL_FUNERAL', '{"en":"GL Funeral","st":"GL Funeral"}', '{"en":"Funeral cover premium","st":"Tefo ea inshorense ea lepato"}',
 'shield-checkmark', '#B45309', 'bills', 50, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-metropolitan', 'METROPOLITAN', '{"en":"Metropolitan","st":"Metropolitan"}', '{"en":"Insurance premium","st":"Tefo ea inshorense"}',
 'shield-checkmark', '#0369A1', 'bills', 60, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-zenith-horizon', 'ZENITH_HORIZON', '{"en":"Zenith Horizon","st":"Zenith Horizon"}', '{"en":"Insurance premium","st":"Tefo ea inshorense"}',
 'shield-checkmark', '#DB2777', 'bills', 70, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-ling', 'LING', '{"en":"LING","st":"LING"}', '{"en":"Insurance premium","st":"Tefo ea inshorense"}',
 'shield-checkmark', '#15803D', 'bills', 80, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-naleli-funeral', 'NALELI_FUNERAL', '{"en":"Naleli Funeral","st":"Naleli Funeral"}', '{"en":"Funeral cover premium","st":"Tefo ea inshorense ea lepato"}',
 'shield-checkmark', '#9333EA', 'bills', 90, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
('bill-liberty', 'LIBERTY', '{"en":"Liberty","st":"Liberty"}', '{"en":"Insurance premium","st":"Tefo ea inshorense"}',
 'shield-checkmark', '#1E3A8A', 'bills', 100, true, 'bill',
 pg_temp.biller_fields('Policy number', 'Nomoro ea polisi', 'On your policy document', 'Tokomaneng ea polisi ea hau', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'insurance'),
-- Financial
('bill-lesana', 'LESANA', '{"en":"Lesana Lesotho","st":"Lesana Lesotho"}', '{"en":"Loan repayment","st":"Tefo ea kalimo"}',
 'business', '#0F766E', 'bills', 10, true, 'bill',
 pg_temp.biller_fields('Loan or account number', 'Nomoro ea kalimo kapa akhaonto', 'On your Lesana statement', 'Polelong ea hau ea Lesana', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'financial'),
('bill-peoples-saccos', 'PEOPLES_SACCOS', '{"en":"Peoples SACCOS","st":"Peoples SACCOS"}', '{"en":"Savings or loan payment","st":"Tefo ea polokelo kapa kalimo"}',
 'business', '#0369A1', 'bills', 20, true, 'bill',
 pg_temp.biller_fields('Member number', 'Nomoro ea setho', 'On your SACCOS card or statement', 'Kareteng kapa polelong ea SACCOS', 3, 30), '{"fixed":0,"percent":0}', '{"min":5,"max":20000}', true, 'financial');

-- The app PIN: opens the app (instead of the wallet PIN, when set). The wallet PIN still pays and works on *199#.
ALTER TABLE users ADD COLUMN app_pin_hash text;
ALTER TABLE users ADD COLUMN app_pin_salt text;
ALTER TABLE users ADD COLUMN app_failed_pins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN app_locked_until timestamptz;
