function clone(value) {
  return structuredClone(value)
}

export function normalizeDictionaryConfig(input = {}) {
  const dictionaries = input.dictionaries
  if (!dictionaries || typeof dictionaries !== 'object' || Array.isArray(dictionaries)) {
    const error = new Error('字典配置缺少 dictionaries 对象')
    error.statusCode = 400
    throw error
  }

  const normalized = {}
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    if (!code || !dictionary || !Array.isArray(dictionary.items)) {
      const error = new Error(`字典 ${code || '未知'} 格式不正确`)
      error.statusCode = 400
      throw error
    }
    const values = new Set()
    const items = dictionary.items.map((item, index) => {
      const value = String(item?.value || '').trim()
      const label = String(item?.label || '').trim()
      if (!value || !label || values.has(value)) {
        const error = new Error(`字典 ${code} 存在空值或重复系统编码`)
        error.statusCode = 400
        throw error
      }
      values.add(value)
      return { value, label, enabled: item.enabled !== false, sort: Number.isFinite(item.sort) ? item.sort : index * 10 }
    })
    normalized[code] = { label: String(dictionary.label || code).trim(), items }
  }
  return { version: Number(input.version || 1), dictionaries: normalized }
}

export function createDictionaryRepository(pool, defaults) {
  const normalizedDefaults = normalizeDictionaryConfig(defaults)

  async function write(payload, actor, resetVersion = false) {
    const normalized = normalizeDictionaryConfig(payload)
    const { rows } = await pool.query(`INSERT INTO app_configuration (key, payload, updated_by)
      VALUES ('dictionaries', $1::jsonb, $2)
      ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload,
        version = CASE WHEN $3 THEN 1 ELSE app_configuration.version + 1 END,
        updated_by = EXCLUDED.updated_by, updated_at = now()
      RETURNING payload, version, updated_by, updated_at`,
    [JSON.stringify(normalized), actor, resetVersion])
    return { ...rows[0].payload, version: rows[0].version, updatedBy: rows[0].updated_by, updatedAt: rows[0].updated_at }
  }

  return {
    async get() {
      const { rows } = await pool.query("SELECT payload, version, updated_by, updated_at FROM app_configuration WHERE key = 'dictionaries'")
      if (!rows[0]) return write(clone(normalizedDefaults), '系统初始化', true)
      return { ...rows[0].payload, version: rows[0].version, updatedBy: rows[0].updated_by, updatedAt: rows[0].updated_at }
    },
    save(payload, actor = '系统操作员') {
      return write(payload, actor, false)
    },
    reset(actor = '系统操作员') {
      return write(clone(normalizedDefaults), actor, false)
    },
  }
}
