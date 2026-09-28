ALTER TABLE sku
  ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE sku
SET image_urls = jsonb_build_array(image_url)
WHERE image_url IS NOT NULL
  AND btrim(image_url) <> ''
  AND image_urls = '[]'::jsonb;
