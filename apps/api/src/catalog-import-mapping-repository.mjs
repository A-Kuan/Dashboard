import { createHash, randomUUID } from 'node:crypto'

const allowedFields = new Set(['nameZh', 'nameEn', 'brand', 'category', 'unit', 'primaryOe', 'vehicle', 'years', 'condition', 'sourceSystem', 'sourceRecordId'])

function text(value) {
  return String(value ?? '').trim()
}

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'INVALID_IMPORT_MAPPING'
  return error
}

export function normalizeMappingHeader(value) {
  return text(value).toLowerCase().replace(/[\s_\-./\\()（）]+/g, '')
}

export function catalogHeaderSignature(columns = []) {
  const normalized = columns.map((column) => normalizeMappingHeader(column?.sourceKey || column?.label)).filter(Boolean).sort()
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function normalizeSourcePattern(value) {
  return text(value).toLowerCase().replace(/\.[^.]+$/, '').replace(/(?:19|20)\d{2}[-_.]?\d{0,2}[-_.]?\d{0,2}/g, '').replace(/\bv?\d+(?:[._-]\d+)*\b/g, '').replace(/[\s_.-]+/g, '-').replace(/^-|-$/g, '')
}

function normalizeColumns(columns = []) {
  if (!Array.isArray(columns) || !columns.length) throw invalid('至少需要一个原始字段')
  const seen = new Set()
  return columns.map((column, index) => {
    const sourceKey = text(column?.sourceKey || column?.label)
    const label = text(column?.label || sourceKey)
    if (!sourceKey) throw invalid(`第 ${index + 1} 个原始字段不能为空`)
    const normalizedKey = normalizeMappingHeader(sourceKey)
    if (seen.has(normalizedKey)) throw invalid(`原始字段 ${sourceKey} 重复`)
    seen.add(normalizedKey)
    return { sourceKey, label, normalizedKey }
  })
}

function mappingFromIndexes(mapping = {}, columns = []) {
  const result = {}
  const used = new Set()
  for (const [field, rawIndex] of Object.entries(mapping || {})) {
    if (!allowedFields.has(field)) continue
    const index = Number(rawIndex)
    if (!Number.isInteger(index) || index < 0) continue
    const column = columns[index]
    if (!column) throw invalid(`字段 ${field} 指向不存在的原始列`)
    if (used.has(column.normalizedKey)) throw invalid('同一原始列不能映射到多个 SKU 字段')
    used.add(column.normalizedKey)
    result[field] = column.sourceKey
  }
  if (!result.nameZh && !result.nameEn) throw invalid('请映射中文名称或英文名称')
  if (!result.primaryOe) throw invalid('请映射主 OE 字段')
  return result
}

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    sourceNamePattern: row.source_name_pattern,
    headerSignature: row.header_signature,
    sourceHeaders: row.source_headers || [],
    fieldMapping: row.field_mapping || {},
    active: row.active,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function overlap(left, right) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return union ? intersection / union : 0
}

function matchMapping(profile, columns) {
  const indexByKey = new Map(columns.map((column, index) => [column.normalizedKey, index]))
  return Object.fromEntries(Object.entries(profile.field_mapping || {}).map(([field, sourceKey]) => [field, indexByKey.get(normalizeMappingHeader(sourceKey)) ?? -1]))
}

export function createCatalogImportMappingRepository(pool) {
  return {
    async list() {
      const { rows } = await pool.query('SELECT * FROM catalog_import_mapping_profile WHERE active ORDER BY last_used_at DESC NULLS LAST, updated_at DESC')
      return { items: rows.map(mapRow), total: rows.length }
    },

    async match(input = {}) {
      const columns = normalizeColumns(input.columns)
      const headerSignature = catalogHeaderSignature(columns)
      const { rows } = await pool.query('SELECT * FROM catalog_import_mapping_profile WHERE active ORDER BY last_used_at DESC NULLS LAST, updated_at DESC')
      const sourcePattern = normalizeSourcePattern(input.sourceName)
      const exactCandidates = rows.filter((row) => row.header_signature === headerSignature)
      const exactPatternMatches = exactCandidates.filter((row) => sourcePattern && row.source_name_pattern && (sourcePattern.includes(row.source_name_pattern) || row.source_name_pattern.includes(sourcePattern)))
      const exact = exactPatternMatches.sort((left, right) => right.source_name_pattern.length - left.source_name_pattern.length)[0] || (exactCandidates.length === 1 ? exactCandidates[0] : null)
      if (exact) {
        return { status: 'exact', profile: mapRow(exact), suggestedMapping: matchMapping(exact, columns), changes: { added: [], removed: [], similarity: 1 } }
      }
      const currentKeys = columns.map((column) => column.normalizedKey)
      const candidates = rows.map((row) => {
        const savedKeys = (row.source_headers || []).map((column) => normalizeMappingHeader(column.sourceKey || column.label)).filter(Boolean)
        const similarity = overlap(currentKeys, savedKeys)
        const patternMatch = Boolean(sourcePattern && row.source_name_pattern && (sourcePattern.includes(row.source_name_pattern) || row.source_name_pattern.includes(sourcePattern)))
        return { row, savedKeys, similarity, patternMatch }
      }).filter((candidate) => candidate.similarity >= 0.5 && candidate.patternMatch).sort((left, right) => right.similarity - left.similarity || Number(right.row.usage_count) - Number(left.row.usage_count))
      const closest = candidates[0]
      if (!closest) return { status: 'none', profile: null, suggestedMapping: {}, changes: { added: [], removed: [], similarity: 0 } }
      const currentSet = new Set(currentKeys)
      const savedSet = new Set(closest.savedKeys)
      return {
        status: 'drift', profile: mapRow(closest.row), suggestedMapping: matchMapping(closest.row, columns),
        changes: {
          added: columns.filter((column) => !savedSet.has(column.normalizedKey)).map((column) => column.label),
          removed: (closest.row.source_headers || []).filter((column) => !currentSet.has(normalizeMappingHeader(column.sourceKey || column.label))).map((column) => column.label),
          similarity: Number(closest.similarity.toFixed(2)),
        },
      }
    },

    async save(input = {}, actor = '系统操作员') {
      const name = text(input.name)
      if (!name) throw invalid('请输入映射方案名称')
      const columns = normalizeColumns(input.columns)
      const fieldMapping = mappingFromIndexes(input.mapping, columns)
      const headerSignature = catalogHeaderSignature(columns)
      const sourceNamePattern = normalizeSourcePattern(input.sourceName)
      const profileId = text(input.id)
      if (profileId) {
        const expectedVersion = Number(input.expectedVersion)
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw invalid('expectedVersion 必须是正整数')
        const { rows } = await pool.query(`UPDATE catalog_import_mapping_profile SET
          name=$3,source_name_pattern=$4,header_signature=$5,source_headers=$6::jsonb,field_mapping=$7::jsonb,
          version=version+1,updated_by=$8,updated_at=now() WHERE id=$1 AND version=$2 RETURNING *`,
        [profileId, expectedVersion, name, sourceNamePattern, headerSignature, JSON.stringify(columns.map(({ sourceKey, label }) => ({ sourceKey, label }))), JSON.stringify(fieldMapping), actor])
        if (!rows[0]) {
          const exists = (await pool.query('SELECT 1 FROM catalog_import_mapping_profile WHERE id=$1', [profileId])).rowCount
          if (!exists) return null
          const error = new Error('映射方案已被其他人更新，请重新打开后再试')
          error.statusCode = 409
          error.errorCode = 'IMPORT_MAPPING_VERSION_CONFLICT'
          throw error
        }
        return mapRow(rows[0])
      }
      const id = randomUUID()
      const { rows } = await pool.query(`INSERT INTO catalog_import_mapping_profile
        (id,name,source_name_pattern,header_signature,source_headers,field_mapping,created_by,updated_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$7) RETURNING *`,
      [id, name, sourceNamePattern, headerSignature, JSON.stringify(columns.map(({ sourceKey, label }) => ({ sourceKey, label }))), JSON.stringify(fieldMapping), actor])
      return mapRow(rows[0])
    },
  }
}
