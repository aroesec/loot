-- An upgrade is not a first run.
--
-- `onboarded_at` is NULL on every deployment that existed before it was added,
-- so an established ledger would be redirected into the setup questions on the
-- next page load. Anything with transactions in it has evidently been set up.
--
-- Transaction presence is the right signal *here* and the wrong one at runtime:
-- this runs once, at the moment of upgrade, whereas a runtime check would
-- re-open the flow for anyone who deleted their last row.
UPDATE settings
SET onboarded_at = now()
WHERE onboarded_at IS NULL
  AND EXISTS (SELECT 1 FROM transactions);
