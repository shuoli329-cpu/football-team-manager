-- Existing price_cents remains the legacy per-person amount. NULL means legacy pricing.
ALTER TABLE games ADD COLUMN total_fee_cents INTEGER;
