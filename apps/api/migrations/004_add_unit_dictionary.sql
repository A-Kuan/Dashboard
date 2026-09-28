UPDATE app_configuration
SET payload = jsonb_set(
      payload,
      '{dictionaries,unit}',
      '{"label":"计量单位","items":[{"value":"件","label":"件","sort":0,"enabled":true},{"value":"套","label":"套","sort":10,"enabled":true},{"value":"盒","label":"盒","sort":20,"enabled":true},{"value":"支","label":"支","sort":30,"enabled":true}]}'::jsonb,
      true
    ),
    version = version + 1,
    updated_by = '系统迁移',
    updated_at = now()
WHERE key = 'dictionaries'
  AND NOT (payload -> 'dictionaries' ? 'unit');
