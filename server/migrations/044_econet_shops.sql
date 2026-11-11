-- Econet retail shops as their own kind of place, seeded from the store locator on etl.co.ls (16 shops, with the
-- coordinates and hours published there). Staff edit or remove them in the portal. Additive only.

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_check;
ALTER TABLE places ADD CONSTRAINT places_kind_check CHECK (kind IN ('agent', 'merchant', 'atm', 'shop'));

-- The made-up "EcoCash Shop Kingsway" agent from 040 is replaced by the real shops below.
DELETE FROM places WHERE id = 'place-agent-kingsway';

INSERT INTO places (id, kind, name, address, lat, lng, hours, phone, code) VALUES
('shop-butha-buthe', 'shop', 'Econet Shop Butha-Buthe', 'Butha-Buthe', -28.769083, 28.248917, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-thaba-tseka', 'shop', 'Econet Shop Thaba-Tseka', 'Thaba-Tseka', -29.514690, 28.603840, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-lndc', 'shop', 'Econet Shop LNDC', 'LNDC, Maseru', -29.313393, 27.479652, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-masianokeng', 'shop', 'Econet Shop Masianokeng', 'Masianokeng, Maseru', -29.390278, 27.560278, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-quthing', 'shop', 'Econet Shop Quthing', 'Quthing', -30.400580, 27.704050, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-maseru-mall', 'shop', 'Econet Shop Maseru Mall', 'Maseru Mall, Maseru', -29.335528, 27.484861, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-teyateyaneng', 'shop', 'Econet Shop Teyateyaneng', 'Teyateyaneng, Berea', -29.149778, 27.746028, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-leribe', 'shop', 'Econet Shop Leribe', 'Hlotse, Leribe', -28.867439, 28.050761, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-maputsoe', 'shop', 'Econet Shop Maputsoe', 'Maputsoe, Leribe', -28.886750, 27.899333, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-pioneer', 'shop', 'Econet Shop Pioneer', 'Pioneer Mall, Maseru', -29.316833, 27.478111, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-container', 'shop', 'Econet Shop Container', 'Maseru', -29.314167, 27.481694, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-roma', 'shop', 'Econet Shop Roma', 'Roma, Maseru', -29.448917, 27.716278, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-mafeteng', 'shop', 'Econet Shop Mafeteng', 'Mafeteng', -29.823111, 27.243417, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-mohales-hoek', 'shop', 'Econet Shop Mohale''s Hoek', 'Mohale''s Hoek', -30.151985, 27.477862, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-qachas-nek', 'shop', 'Econet Shop Qacha''s Nek', 'Qacha''s Nek', -30.117528, 28.685500, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL),
('shop-mokhotlong', 'shop', 'Econet Shop Mokhotlong', 'Mokhotlong', -29.288472, 29.064222, 'Mon–Fri 8am–6pm, Sat 8am–2pm, Sun 8–10am', '100', NULL)
ON CONFLICT (id) DO NOTHING;
