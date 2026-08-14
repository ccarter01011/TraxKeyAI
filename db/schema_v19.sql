-- TraxKey AI — schema v19: non-empty text constraints
--
-- Moves "this field can't be blank" out of hand-written SQL guards and into
-- the database.
--
-- Why: the workflows were validating free text with a WHERE guard like
--   AND '{{ body.area }}' <> ''
-- which interpolated raw user input into SQL. That is both fragile to quote
-- correctly and pointless duplication, the database is the right place to
-- assert a column can't be blank. With these constraints the guards can be
-- deleted rather than escaped, which removes the injectable surface instead
-- of trying to sanitize it.
--
-- NOT NULL alone is not enough: an empty string satisfies NOT NULL.

SET search_path TO traxkey;

ALTER TABLE inspection_items
  ADD CONSTRAINT inspection_items_area_not_blank CHECK (length(trim(area)) > 0),
  ADD CONSTRAINT inspection_items_item_not_blank CHECK (length(trim(item)) > 0);

ALTER TABLE business_memory
  ADD CONSTRAINT business_memory_value_not_blank CHECK (length(trim(value)) > 0);

ALTER TABLE leads
  ADD CONSTRAINT leads_name_not_blank CHECK (length(trim(name)) > 0),
  ADD CONSTRAINT leads_email_not_blank CHECK (length(trim(email)) > 0);
