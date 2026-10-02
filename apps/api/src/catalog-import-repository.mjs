import { createHash, randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'
import { normalizeCatalogInput, normalizeIdentifierValue } from './catalog-validation.mjs'
import { buildImportPreflightReport, catalogImportFields, catalogImportTemplateSpec } from './catalog-import-spec.mjs'

function text(value) {
  return String(value ?? '').trim()
}

export function analyzeCatalogImportRows(rows = []) {
  const canonicalRows = rows.map((row) => Object.fromEntries(catalogImportFields.map((field) => {
    const value = text(row?.[field.key])
    return [field.key, field.key === 'primaryOe' ? normalizeIdentifierValue(value) : value]
  })))
  const fingerprintRows = canonicalRows.map((row) => JSON.stringify(row)).sort()
  const contentHash = createHash('sha256').update(JSON.stringify(fingerprintRows)).digest('hex')
  const identifierRows = new Map()
  canonicalRows.forEach((row, index) => {
    const identifier = normalizeIdentifierValue(row.primaryOe)
    if (!identifier) return
    const rowNumber = index + 2
    identifierRows.set(identifier, [...(identifierRows.get(identifier) || []), rowNumber])
  })
  const inFileDuplicates = Object.fromEntries([...identifierRows.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1))
  return { contentHash, canonicalRows, inFileDuplicates }
}

function normalizeRow(row, rowNumber, sourceName, intakeId) {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? row : {}
  const primaryOe = text(raw.primaryOe)
  const hasFitment = Boolean(text(raw.vehicle))
  const payload = normalizeCatalogInput({
    identity: {
      nameZh: text(raw.nameZh), nameEn: text(raw.nameEn), brandCode: text(raw.brand), brandLabel: text(raw.brand),
      categoryCode: text(raw.category), categoryLabel: text(raw.category), unitCode: text(raw.unit) || 'piece', unitLabel: text(raw.unit) || '件',
    },
    evidence: [{
      clientKey: 'source-0', intakeId, sourceType: 'import', sourceSystem: text(raw.sourceSystem) || '批量导入',
      sourceRecordId: text(raw.sourceRecordId), catalogPath: sourceName, figurePosition: `第 ${rowNumber} 行`,
      originalName: text(raw.originalName) || text(raw.nameZh), rawPayload: raw, confidence: 'pending',
    }],
    identifiers: primaryOe ? [{ clientKey: 'identifier-primary', type: 'oe', rawValue: primaryOe, isPrimary: true, evidenceKey: 'source-0' }] : [],
    fitments: hasFitment ? [{
      vehicleLabel: text(raw.vehicle), years: text(raw.years), includeConditions: text(raw.condition) ? { note: text(raw.condition) } : {},
      evidenceKey: 'source-0', verificationStatus: 'pending',
    }] : [],
  })
  const issues = []
  if (!payload.identity.nameZh && !payload.identity.nameEn) issues.push({ code: 'MISSING_NAME', severity: 'error', message: '缺少零件名称' })
  if (!primaryOe) issues.push({ code: 'MISSING_PRIMARY_OE', severity: 'error', message: '缺少主 OE 编号' })
  if (!payload.identity.brandLabel) issues.push({ code: 'MISSING_BRAND', severity: 'warning', message: '品牌待补充' })
  if (!payload.identity.categoryLabel) issues.push({ code: 'MISSING_CATEGORY', severity: 'warning', message: '分类待补充' })
  if (!hasFitment) issues.push({ code: 'MISSING_FITMENT', severity: 'warning', message: '适配车型待补充' })
  return { payload, issues, normalizedPrimaryOe: normalizeIdentifierValue(primaryOe) }
}

function mapRow(row) {
  return {
    id: row.id, rowNumber: row.row_number, state: row.state, payload: row.normalized_payload,
    issues: row.issues || [], duplicateMatches: row.duplicate_matches || [], importedSkuId: row.imported_sku_id || '',
    errorMessage: row.error_message || '',
  }
}

function mapAttempt(row) {
  return {
    id: row.id, attemptNumber: row.attempt_number, attemptType: row.attempt_type, state: row.state,
    selectedRows: row.selected_rows, importedRows: row.imported_rows, failedRows: row.failed_rows,
    startedBy: row.started_by, startedAt: row.started_at, completedAt: row.completed_at,
  }
}

function mapJob(row, rows = [], attempts = []) {
  return {
    id: row.id, intakeId: row.intake_id, sourceName: row.source_name, state: row.state, totalRows: row.total_rows,
    readyRows: row.ready_rows, duplicateRows: row.duplicate_rows, invalidRows: row.invalid_rows,
    importedRows: row.imported_rows, failedRows: row.failed_rows, createdBy: row.created_by,
    createdAt: row.created_at, committedAt: row.committed_at, version: row.version,
    contentFingerprint: row.content_hash ? row.content_hash.slice(0, 12) : '',
    mappingProfileId: row.mapping_profile_id || '', mappingSnapshot: row.mapping_snapshot || {},
    attemptCount: Number(row.attempt_count ?? attempts.length), lastAttemptAt: row.last_attempt_at || attempts[0]?.started_at || null,
    preflight: buildImportPreflightReport(rows, { readyRows: row.ready_rows, duplicateRows: row.duplicate_rows, invalidRows: row.invalid_rows }),
    rows: rows.map(mapRow), attempts: attempts.map(mapAttempt),
  }
}

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'INVALID_IMPORT'
  return error
}

export function createCatalogImportRepository(pool, catalogRepository) {
  async function getJobWith(client, id) {
    const job = (await client.query('SELECT * FROM catalog_import_job WHERE id=$1', [id])).rows[0]
    if (!job) return null
    const [rows, attempts] = await Promise.all([
      client.query('SELECT * FROM catalog_import_row WHERE job_id=$1 ORDER BY row_number', [id]),
      client.query('SELECT * FROM catalog_import_attempt WHERE job_id=$1 ORDER BY attempt_number DESC', [id]),
    ])
    return mapJob(job, rows.rows, attempts.rows)
  }

  return {
    async list({ state = '', page = 1, pageSize = 20 } = {}) {
      const safePage = Math.max(1, Number(page) || 1)
      const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
      const values = []
      const clauses = []
      if (state) { values.push(state); clauses.push(`j.state=$${values.length}`) }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const count = await pool.query(`SELECT count(*)::int AS total FROM catalog_import_job j ${where}`, values)
      values.push(safeSize, (safePage - 1) * safeSize)
      const { rows } = await pool.query(`SELECT j.*,
        (SELECT count(*)::int FROM catalog_import_attempt a WHERE a.job_id=j.id) AS attempt_count,
        (SELECT started_at FROM catalog_import_attempt a WHERE a.job_id=j.id ORDER BY attempt_number DESC LIMIT 1) AS last_attempt_at
        FROM catalog_import_job j ${where} ORDER BY j.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
      return { items: rows.map((row) => mapJob(row)), total: count.rows[0].total, page: safePage, pageSize: safeSize }
    },

    async createPreview(input, actor = '系统操作员') {
      const sourceName = text(input?.sourceName)
      const rows = Array.isArray(input?.rows) ? input.rows : []
      const mappingProfile = input?.mappingProfile && typeof input.mappingProfile === 'object' ? input.mappingProfile : null
      if (!sourceName) throw invalid('sourceName 不能为空')
      if (!rows.length) throw invalid('导入文件没有可处理的数据行')
      if (rows.length > catalogImportTemplateSpec.maxRows) throw invalid(`单次最多导入 ${catalogImportTemplateSpec.maxRows} 行`)

      const fileAnalysis = analyzeCatalogImportRows(rows)
      const existing = (await pool.query('SELECT id FROM catalog_import_job WHERE content_hash=$1 LIMIT 1', [fileAnalysis.contentHash])).rows[0]
      if (existing) return { ...(await getJobWith(pool, existing.id)), duplicateUpload: true }

      const intakeId = randomUUID()
      const normalizedRows = rows.map((row, index) => normalizeRow(row, index + 2, sourceName, intakeId))
      normalizedRows.forEach((row, index) => {
        const duplicateRows = fileAnalysis.inFileDuplicates[row.normalizedPrimaryOe] || []
        if (duplicateRows.length > 1) row.issues.push({
          code: 'DUPLICATE_IN_FILE', severity: 'warning', message: `主 OE 与文件第 ${duplicateRows.filter((rowNumber) => rowNumber !== index + 2).join('、')} 行重复`,
        })
      })
      const identifiers = normalizedRows.map((row) => row.normalizedPrimaryOe).filter(Boolean)
      const duplicateMap = await catalogRepository.findDuplicatesMany(identifiers)

      return withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`catalog-import:${fileAnalysis.contentHash}`])
        const concurrent = (await client.query('SELECT id FROM catalog_import_job WHERE content_hash=$1 LIMIT 1', [fileAnalysis.contentHash])).rows[0]
        if (concurrent) return { ...(await getJobWith(client, concurrent.id)), duplicateUpload: true }
        const jobId = randomUUID()
        await client.query(`INSERT INTO catalog_intake (id,source_type,state,source_context,raw_payload,created_by)
          VALUES ($1,'import','preview',$2::jsonb,$3::jsonb,$4)`,
        [intakeId, JSON.stringify({ sourceName, rowCount: rows.length, mappingProfile }), JSON.stringify({ rows }), actor])

        let readyRows = 0
        let duplicateRows = 0
        let invalidRows = 0
        const prepared = normalizedRows.map((item, index) => {
          const fileMatches = (fileAnalysis.inFileDuplicates[item.normalizedPrimaryOe] || []).filter((rowNumber) => rowNumber !== index + 2).map((rowNumber) => ({ scope: 'file', rowNumber }))
          const duplicates = item.normalizedPrimaryOe ? [...(duplicateMap[item.normalizedPrimaryOe] || []), ...fileMatches] : []
          const hasError = item.issues.some((issue) => issue.severity === 'error')
          const state = hasError ? 'invalid' : duplicates.length ? 'duplicate' : 'ready'
          if (state === 'ready') readyRows += 1
          if (state === 'duplicate') duplicateRows += 1
          if (state === 'invalid') invalidRows += 1
          return { id: randomUUID(), rowNumber: index + 2, ...item, duplicates, state }
        })

        const profileId = text(mappingProfile?.id) || null
        let mappingSnapshot = {}
        if (profileId) {
          const updated = await client.query('UPDATE catalog_import_mapping_profile SET usage_count=usage_count+1,last_used_at=now() WHERE id=$1 AND active RETURNING name,header_signature,version,default_values,transform_rules', [profileId])
          if (!updated.rows[0]) throw invalid('选择的映射方案不存在或已停用')
          const sourceKeys = new Set(rows.flatMap((row) => Object.keys(row?._sourceRow || {})))
          const allowedFields = new Set(catalogImportFields.map((field) => field.key))
          const fieldMapping = Object.fromEntries(Object.entries(mappingProfile?.fieldMapping || {}).flatMap(([field, sourceKey]) => {
            const value = text(sourceKey)
            return allowedFields.has(field) && sourceKeys.has(value) ? [[field, value]] : []
          }))
          const matchStatus = ['created', 'updated', 'exact', 'drift', 'manual_override'].includes(text(mappingProfile?.matchStatus)) ? text(mappingProfile.matchStatus) : 'manual_override'
          mappingSnapshot = {
            id: profileId, name: updated.rows[0].name, version: updated.rows[0].version,
            matchStatus, headerSignature: updated.rows[0].header_signature, fieldMapping,
            defaultValues: updated.rows[0].default_values || {},
            transformRules: updated.rows[0].transform_rules || {},
          }
        }
        const { rows: jobs } = await client.query(`INSERT INTO catalog_import_job
          (id,intake_id,source_name,total_rows,ready_rows,duplicate_rows,invalid_rows,created_by,content_hash,mapping_profile_id,mapping_snapshot)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
        [jobId, intakeId, sourceName, rows.length, readyRows, duplicateRows, invalidRows, actor, fileAnalysis.contentHash, profileId, JSON.stringify(mappingSnapshot)])
        for (const item of prepared) {
          await client.query(`INSERT INTO catalog_import_row
            (id,job_id,row_number,normalized_payload,state,issues,duplicate_matches)
            VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb)`,
          [item.id, jobId, item.rowNumber, JSON.stringify(item.payload), item.state, JSON.stringify(item.issues), JSON.stringify(item.duplicates)])
        }
        return { ...(await getJobWith(client, jobs[0].id)), duplicateUpload: false }
      })
    },

    get(id) {
      return getJobWith(pool, id)
    },

    async commit(id, input, actor = '系统操作员') {
      const expectedVersion = Number(input?.expectedVersion)
      const selectedIds = [...new Set(Array.isArray(input?.rowIds) ? input.rowIds.map(text).filter(Boolean) : [])]
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw invalid('expectedVersion 必须是正整数')
      if (!selectedIds.length) throw invalid('至少选择一条可导入记录')

      const preparedAttempt = await withTransaction(pool, async (client) => {
        const job = (await client.query('SELECT * FROM catalog_import_job WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!job) return null
        if (job.version !== expectedVersion) {
          const error = new Error(`导入批次已更新（当前版本 v${job.version}）`)
          error.statusCode = 409
          error.errorCode = 'IMPORT_VERSION_CONFLICT'
          throw error
        }
        if (job.state !== 'preview') {
          const error = new Error('该导入批次不能重复提交')
          error.statusCode = 409
          error.errorCode = 'IMPORT_ALREADY_COMMITTED'
          throw error
        }
        const result = await client.query(`SELECT * FROM catalog_import_row WHERE job_id=$1 AND id=ANY($2::text[]) ORDER BY row_number`, [id, selectedIds])
        if (result.rows.length !== selectedIds.length || result.rows.some((row) => !['ready', 'duplicate'].includes(row.state))) throw invalid('选择中包含不可导入的记录')
        await client.query("UPDATE catalog_import_job SET state='committing',version=version+1 WHERE id=$1", [id])
        const attemptId = randomUUID()
        await client.query(`INSERT INTO catalog_import_attempt (id,job_id,attempt_number,attempt_type,selected_rows,started_by)
          VALUES ($1,$2,1,'initial',$3,$4)`, [attemptId, id, result.rows.length, actor])
        return { rows: result.rows, attemptId }
      })
      if (!preparedAttempt) return null

      let imported = 0
      let failed = 0
      for (const row of preparedAttempt.rows) {
        try {
          const sku = await catalogRepository.create(row.normalized_payload, actor)
          await pool.query("UPDATE catalog_import_row SET state='imported',imported_sku_id=$2,updated_at=now() WHERE id=$1", [row.id, sku.id])
          imported += 1
        } catch (error) {
          await pool.query("UPDATE catalog_import_row SET state='failed',error_message=$2,updated_at=now() WHERE id=$1", [row.id, error.message || '写入失败'])
          failed += 1
        }
      }
      await pool.query(`UPDATE catalog_import_row SET state='skipped',updated_at=now() WHERE job_id=$1 AND state IN ('ready','duplicate')`, [id])
      await pool.query(`UPDATE catalog_import_job SET state=$2,imported_rows=$3,failed_rows=$4,committed_at=now(),version=version+1 WHERE id=$1`,
        [id, failed ? 'partial' : 'completed', imported, failed])
      await pool.query(`UPDATE catalog_import_attempt SET state=$2,imported_rows=$3,failed_rows=$4,completed_at=now() WHERE id=$1`,
        [preparedAttempt.attemptId, failed ? 'partial' : 'completed', imported, failed])
      await pool.query("UPDATE catalog_intake SET state=$2,updated_at=now(),version=version+1 WHERE id=(SELECT intake_id FROM catalog_import_job WHERE id=$1)", [id, failed ? 'partial' : 'completed'])
      return getJobWith(pool, id)
    },

    async retry(id, input, actor = '系统操作员') {
      const expectedVersion = Number(input?.expectedVersion)
      const requestedIds = [...new Set(Array.isArray(input?.rowIds) ? input.rowIds.map(text).filter(Boolean) : [])]
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw invalid('expectedVersion 必须是正整数')
      const preparedAttempt = await withTransaction(pool, async (client) => {
        const job = (await client.query('SELECT * FROM catalog_import_job WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!job) return null
        if (job.version !== expectedVersion) {
          const error = new Error(`导入批次已更新（当前版本 v${job.version}）`)
          error.statusCode = 409
          error.errorCode = 'IMPORT_VERSION_CONFLICT'
          throw error
        }
        if (job.state !== 'partial') {
          const error = new Error('只有存在失败记录的批次可以重试')
          error.statusCode = 409
          error.errorCode = 'IMPORT_NOT_RETRYABLE'
          throw error
        }
        const parameters = [id]
        let rowFilter = "job_id=$1 AND state='failed'"
        if (requestedIds.length) { parameters.push(requestedIds); rowFilter += ` AND id=ANY($2::text[])` }
        const result = await client.query(`SELECT * FROM catalog_import_row WHERE ${rowFilter} ORDER BY row_number`, parameters)
        if (!result.rows.length || (requestedIds.length && result.rows.length !== requestedIds.length)) throw invalid('没有可重试的失败记录')
        const attemptNumber = (await client.query('SELECT COALESCE(max(attempt_number),0)::int+1 AS next FROM catalog_import_attempt WHERE job_id=$1', [id])).rows[0].next
        const attemptId = randomUUID()
        await client.query("UPDATE catalog_import_row SET state='retrying',error_message='',updated_at=now() WHERE id=ANY($1::text[])", [result.rows.map((row) => row.id)])
        await client.query("UPDATE catalog_import_job SET state='retrying',version=version+1 WHERE id=$1", [id])
        await client.query(`INSERT INTO catalog_import_attempt (id,job_id,attempt_number,attempt_type,selected_rows,started_by)
          VALUES ($1,$2,$3,'retry',$4,$5)`, [attemptId, id, attemptNumber, result.rows.length, actor])
        return { rows: result.rows, attemptId }
      })
      if (!preparedAttempt) return null

      let imported = 0
      let failed = 0
      for (const row of preparedAttempt.rows) {
        try {
          const sku = await catalogRepository.create(row.normalized_payload, actor)
          await pool.query("UPDATE catalog_import_row SET state='imported',imported_sku_id=$2,error_message='',updated_at=now() WHERE id=$1", [row.id, sku.id])
          imported += 1
        } catch (error) {
          await pool.query("UPDATE catalog_import_row SET state='failed',error_message=$2,updated_at=now() WHERE id=$1", [row.id, error.message || '重试失败'])
          failed += 1
        }
      }
      const totals = (await pool.query(`SELECT count(*) FILTER (WHERE state='imported')::int AS imported,
        count(*) FILTER (WHERE state='failed')::int AS failed FROM catalog_import_row WHERE job_id=$1`, [id])).rows[0]
      const finalState = totals.failed ? 'partial' : 'completed'
      await pool.query(`UPDATE catalog_import_job SET state=$2,imported_rows=$3,failed_rows=$4,committed_at=now(),version=version+1 WHERE id=$1`,
        [id, finalState, totals.imported, totals.failed])
      await pool.query(`UPDATE catalog_import_attempt SET state=$2,imported_rows=$3,failed_rows=$4,completed_at=now() WHERE id=$1`,
        [preparedAttempt.attemptId, failed ? 'partial' : 'completed', imported, failed])
      await pool.query("UPDATE catalog_intake SET state=$2,updated_at=now(),version=version+1 WHERE id=(SELECT intake_id FROM catalog_import_job WHERE id=$1)", [id, finalState])
      return getJobWith(pool, id)
    },
  }
}
