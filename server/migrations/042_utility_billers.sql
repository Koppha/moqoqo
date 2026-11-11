-- Pay bill › Utility: LAA and Maseru City Council, added on behalf of the portal. PLACEHOLDER fields, fees and limits
-- until ETL confirms each one's real details; staff edit or remove them in the portal (Services). Additive only.

INSERT INTO services (id, code, name, description, icon, color, placement, sort, enabled, executor, fields, fee, limits, confirm_name, category) VALUES
('bill-laa', 'LAA', '{"en":"LAA","st":"LAA"}', '{"en":"Land Administration Authority: ground rent and lease fees","st":"Land Administration Authority: rente ea mobu le litefo tsa lease"}',
 'map', '#7C2D12', 'bills', 10, true, 'bill',
 '[{"key":"account","type":"text","label":{"en":"Plot or lease number","st":"Nomoro ea setsha kapa lease"},"hint":{"en":"On your lease or LAA invoice, e.g. 12345-678","st":"Ho lease kapa invoice ea LAA, mohl. 12345-678"},"required":true,"minLength":3,"maxLength":30},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":5,"max":50000}]',
 '{"fixed":0,"percent":0}', '{"min":5,"max":50000}', true, 'utility'),
('bill-mcc', 'MASERU_CITY_COUNCIL', '{"en":"Maseru City Council","st":"Maseru City Council"}', '{"en":"Rates, licences and council fees","st":"Lekhetho, lilaesense le litefo tsa khanselete"}',
 'business', '#1D4ED8', 'bills', 20, true, 'bill',
 '[{"key":"account","type":"text","label":{"en":"Account number","st":"Nomoro ea akhaonto"},"hint":{"en":"On your council bill","st":"Ho tefo ea hau ea khanselete"},"required":true,"minLength":3,"maxLength":30},
   {"key":"amount","type":"amount","label":{"en":"Amount","st":"Chelete"},"required":true,"min":5,"max":50000}]',
 '{"fixed":0,"percent":0}', '{"min":5,"max":50000}', true, 'utility');
