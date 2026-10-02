const ruleFields = ['brand', 'category', 'unit']

function fullWidthToHalfWidth(value) {
  return String(value ?? '').replace(/[！-～]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ')
}

export function normalizeValueMappingKey(value) {
  return fullWidthToHalfWidth(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

export function normalizeCatalogValueMappings(input = {}) {
  return Object.fromEntries(ruleFields.map((field) => {
    const seen = new Set()
    const rows = (Array.isArray(input?.[field]) ? input[field] : []).flatMap((entry) => {
      const source = String(entry?.source ?? '').trim()
      const target = String(entry?.target ?? '').trim()
      const key = normalizeValueMappingKey(source)
      if (!source || !target || !key || seen.has(key)) return []
      seen.add(key)
      return [{ source, target }]
    }).slice(0, 200)
    return [field, rows]
  }))
}

export function mergeCatalogValueMappings(current = {}, resolutions = []) {
  const next = normalizeCatalogValueMappings(current)
  for (const resolution of resolutions) {
    const field = String(resolution?.field || '')
    const source = String(resolution?.source ?? '').trim()
    const target = String(resolution?.target ?? '').trim()
    if (!ruleFields.includes(field) || !source || !target) continue
    const key = normalizeValueMappingKey(source)
    const existingIndex = next[field].findIndex((entry) => normalizeValueMappingKey(entry.source) === key)
    if (existingIndex >= 0) next[field][existingIndex] = { source, target }
    else next[field].push({ source, target })
  }
  return normalizeCatalogValueMappings(next)
}

export function applyCatalogImportProfile(row = {}, profile = {}) {
  const next = { ...row }
  const defaults = profile.defaultValues || {}
  const rules = profile.transformRules || {}
  for (const field of ['nameZh', 'nameEn', 'brand', 'category', 'unit', 'primaryOe', 'vehicle', 'years', 'condition', 'sourceSystem', 'sourceRecordId']) {
    let value = String(next[field] || '')
    if (rules.normalizeFullWidth !== false) value = fullWidthToHalfWidth(value)
    if (rules.trimText !== false) value = value.trim()
    if (rules.collapseWhitespace !== false) value = value.replace(/\s+/g, ' ')
    if (field === 'primaryOe' && rules.uppercaseOe !== false) value = value.toUpperCase()
    if (!value && defaults[field]) value = String(defaults[field])
    next[field] = value
  }

  const issues = []
  const mappings = normalizeCatalogValueMappings(profile.valueMappings)
  for (const field of ruleFields) {
    const value = String(next[field] || '')
    const entries = mappings[field]
    if (!value || !entries.length) continue
    const key = normalizeValueMappingKey(value)
    const matched = entries.find((entry) => normalizeValueMappingKey(entry.source) === key || normalizeValueMappingKey(entry.target) === key)
    if (matched) next[field] = matched.target
    else issues.push({ field, value })
  }
  next._valueMappingIssues = issues
  return next
}
