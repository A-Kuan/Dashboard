import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'
import { normalizeDictionaryConfig } from './dictionary-repository.mjs'

const fieldDictionary = { brand: 'sku_brand', category: 'part_category', unit: 'unit' }

function text(value) {
  return String(value ?? '').trim()
}

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'INVALID_DICTIONARY_PROPOSAL'
  return error
}

function conflict(message, code = 'DICTIONARY_PROPOSAL_VERSION_CONFLICT') {
  const error = new Error(message)
  error.statusCode = 409
  error.errorCode = code
  return error
}

function mapRow(row) {
  return {
    id: row.id, dictionaryCode: row.dictionary_code, field: row.field, sourceValue: row.source_value,
    proposedValue: row.proposed_value, reason: row.reason, state: row.state, importJobId: row.import_job_id || '',
    mappingProfileId: row.mapping_profile_id || '', requestedBy: row.requested_by, reviewedBy: row.reviewed_by || '',
    reviewNote: row.review_note || '', version: row.version, createdAt: row.created_at, reviewedAt: row.reviewed_at,
  }
}

export function createCatalogDictionaryGovernanceRepository(pool) {
  return {
    async list({ state = 'pending' } = {}) {
      const allowedState = ['pending', 'approved', 'rejected'].includes(state) ? state : ''
      const parameters = allowedState ? [allowedState] : []
      const where = allowedState ? 'WHERE state=$1' : ''
      const { rows } = await pool.query(`SELECT * FROM catalog_dictionary_proposal ${where} ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC`, parameters)
      return { items: rows.map(mapRow), total: rows.length }
    },

    async create(input = {}, actor = '系统操作员') {
      const field = text(input.field)
      const dictionaryCode = fieldDictionary[field]
      const sourceValue = text(input.sourceValue)
      const proposedValue = text(input.proposedValue)
      const reason = text(input.reason)
      if (!dictionaryCode || !sourceValue || !proposedValue || !reason) throw invalid('字段、来源值、建议标准值和申请原因都不能为空')
      if (proposedValue.length > 80 || reason.length > 300) throw invalid('建议标准值或申请原因过长')
      const configuration = (await pool.query("SELECT payload FROM app_configuration WHERE key='dictionaries'")).rows[0]
      const alreadyEnabled = (configuration?.payload?.dictionaries?.[dictionaryCode]?.items || []).some((item) => item.enabled !== false && text(item.value).toLocaleLowerCase('zh-CN') === proposedValue.toLocaleLowerCase('zh-CN'))
      if (alreadyEnabled) throw invalid(`“${proposedValue}”已经是启用的标准值，可直接选择映射`)
      const importJobId = text(input.importJobId)
      let mappingProfileId = text(input.mappingProfileId)
      if (importJobId) {
        const job = (await pool.query('SELECT mapping_profile_id FROM catalog_import_job WHERE id=$1', [importJobId])).rows[0]
        if (!job) throw invalid('关联的导入批次不存在')
        if (mappingProfileId && job.mapping_profile_id !== mappingProfileId) throw invalid('映射方案与导入批次不一致')
        mappingProfileId = job.mapping_profile_id || ''
      }
      const existing = (await pool.query(`SELECT * FROM catalog_dictionary_proposal WHERE dictionary_code=$1 AND lower(proposed_value)=lower($2) AND state='pending'`, [dictionaryCode, proposedValue])).rows[0]
      if (existing) return { ...mapRow(existing), duplicateProposal: true }
      try {
        const row = (await pool.query(`INSERT INTO catalog_dictionary_proposal
          (id,dictionary_code,field,source_value,proposed_value,reason,import_job_id,mapping_profile_id,requested_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [randomUUID(), dictionaryCode, field, sourceValue, proposedValue, reason, importJobId || null, mappingProfileId || null, actor])).rows[0]
        return { ...mapRow(row), duplicateProposal: false }
      } catch (error) {
        if (error.code !== '23505') throw error
        const concurrent = (await pool.query(`SELECT * FROM catalog_dictionary_proposal WHERE dictionary_code=$1 AND lower(proposed_value)=lower($2) AND state='pending'`, [dictionaryCode, proposedValue])).rows[0]
        if (!concurrent) throw error
        return { ...mapRow(concurrent), duplicateProposal: true }
      }
    },

    async review(id, input = {}, actor = '系统管理员') {
      const expectedVersion = Number(input.expectedVersion)
      const decision = text(input.decision)
      const reviewNote = text(input.reviewNote)
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw invalid('expectedVersion 必须是正整数')
      if (!['approve', 'reject'].includes(decision)) throw invalid('decision 只允许 approve 或 reject')
      if (!reviewNote) throw invalid('请填写审核说明')
      return withTransaction(pool, async (client) => {
        const proposal = (await client.query('SELECT * FROM catalog_dictionary_proposal WHERE id=$1 FOR UPDATE', [id])).rows[0]
        if (!proposal) return null
        if (proposal.version !== expectedVersion) throw conflict(`申请已更新（当前版本 v${proposal.version}）`)
        if (proposal.state !== 'pending') throw conflict('该申请已经处理', 'DICTIONARY_PROPOSAL_ALREADY_REVIEWED')
        let dictionaryVersion = null
        if (decision === 'approve') {
          const configuration = (await client.query("SELECT payload,version FROM app_configuration WHERE key='dictionaries' FOR UPDATE")).rows[0]
          if (!configuration) throw invalid('系统字典尚未初始化')
          const normalized = normalizeDictionaryConfig(configuration.payload)
          const dictionary = normalized.dictionaries[proposal.dictionary_code]
          if (!dictionary) throw invalid(`字典 ${proposal.dictionary_code} 不存在`)
          const duplicate = dictionary.items.find((item) => item.value.toLocaleLowerCase('zh-CN') === proposal.proposed_value.toLocaleLowerCase('zh-CN'))
          let dictionaryChanged = false
          if (!duplicate) {
            const nextSort = dictionary.items.reduce((maximum, item) => Math.max(maximum, Number(item.sort) || 0), 0) + 10
            dictionary.items.push({ value: proposal.proposed_value, label: proposal.proposed_value, enabled: true, sort: nextSort })
            dictionaryChanged = true
          } else if (duplicate.enabled === false) {
            duplicate.enabled = true
            dictionaryChanged = true
          }
          if (dictionaryChanged) {
            const updated = (await client.query("UPDATE app_configuration SET payload=$1::jsonb,version=version+1,updated_by=$2,updated_at=now() WHERE key='dictionaries' RETURNING version",
              [JSON.stringify(normalized), actor])).rows[0]
            dictionaryVersion = updated.version
          } else dictionaryVersion = configuration.version
        }
        const row = (await client.query(`UPDATE catalog_dictionary_proposal SET state=$2,reviewed_by=$3,review_note=$4,reviewed_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
          [id, decision === 'approve' ? 'approved' : 'rejected', actor, reviewNote])).rows[0]
        return { ...mapRow(row), dictionaryVersion }
      })
    },
  }
}
