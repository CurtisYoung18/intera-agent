DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT conname FROM pg_constraint WHERE conname LIKE '%orgId%' OR conname LIKE '%vendorId%')
  LOOP
    EXECUTE 'ALTER TABLE IF EXISTS case_types DROP CONSTRAINT IF EXISTS ' || r.conname;
    -- Will fail silently for non-matching tables, which is fine
  END LOOP;
END $$;
