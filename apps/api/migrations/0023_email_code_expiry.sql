-- Lets used-up email codes, sign-up tickets and sign-up address counts be deleted without a
-- full scan.

CREATE INDEX email_codes_by_expiry ON email_codes (expires_at);
