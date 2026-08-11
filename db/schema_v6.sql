-- TraxKey AI — schema v6
-- Adds optional check-in/check-out dates to residents, so the same
-- resident-invite mechanism covers a short-term rental guest for one stay,
-- not just a long-term tenant. No new table: a "guest" is just a resident
-- with dates set, everything else (their own reporting link, the
-- maintenance-request flow) already works unchanged.

SET search_path TO traxkey;

ALTER TABLE residents ADD COLUMN checkin_date date;
ALTER TABLE residents ADD COLUMN checkout_date date;
