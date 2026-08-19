-- v40: phone column for the operator's own profile
--
-- TraxKey had no self-service profile page at all: nothing let the logged-in
-- operator update their own name/email/phone or change their password.
-- users.phone didn't exist because nothing needed it yet.

SET search_path TO traxkey, public;

ALTER TABLE users ADD COLUMN phone text;
