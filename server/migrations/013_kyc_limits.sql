-- Tier-1 (KYC not yet approved) limits, editable in the portal. PLACEHOLDER values until ETL's KYC policy is known.
INSERT INTO app_settings (key, value) VALUES ('kycLimits', '{
  "perTransaction": {"send": 500, "pay": 1000, "bills": 1000, "services": 500, "bank": 0, "ecosure": null},
  "daily": {"send": 1000, "pay": 2000, "bills": 2000, "services": 1000, "bank": 0, "ecosure": null},
  "dailyTotal": 3000
}') ON CONFLICT (key) DO NOTHING;
