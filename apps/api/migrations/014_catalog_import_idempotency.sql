ALTER TABLE catalog_import_job
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_import_job_content_hash_unique
  ON catalog_import_job (content_hash)
  WHERE content_hash IS NOT NULL;
