-- Agent cash-out at the counter: the same payment requests merchants use, paid by QR, code, tap or the
-- customer's payment code, but settled as a cash-out (the agent then hands over the cash). Additive only.
ALTER TABLE payment_intents ADD COLUMN purpose text NOT NULL DEFAULT 'sale' CHECK (purpose IN ('sale', 'cashout'));
