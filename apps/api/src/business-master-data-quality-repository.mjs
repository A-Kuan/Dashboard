import { createHash, randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

const issueKinds = new Set(['customer_duplicate', 'vehicle_duplicate'])
const issueStatuses = new Set(['open', 'suppressed', 'all'])
const issueSlaStatuses = new Set(['unassigned', 'on_track', 'due_soon', 'overdue'])
const decisions = new Set(['not_duplicate', 'deferred'])

function clean(value) { return String(value ?? '').trim() }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}
function boundedPage(value, fallback, maximum) {
  const number = Math.trunc(Number(value) || fallback)
  return Math.max(1, Math.min(maximum, number))
}
function requestKey(value) {
  const result = clean(value)
  if (!result || result.length > 128 || /[\u0000-\u001f\u007f]/.test(result)) throw problem('INVALID_REQUEST_KEY', 'requestKey 必须是 1 至 128 位安全字符')
  return result
}
function identityValue(value, label, maximum) {
  const result = clean(value)
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw problem('INVALID_MASTER_DATA_QUALITY_ASSIGNEE', `${label}必须是 1 至 ${maximum} 位安全字符`)
  return result
}
function actorDetails(actor) { return { id: clean(actor?.id), name: clean(actor?.name) || '系统操作员' } }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function phoneDigits(value) { return clean(value).replace(/\D/g, '') }
function normalizedName(value) { return clean(value).toLocaleLowerCase('zh-CN').replace(/\s+/g, '') }
function selectSurvivor(row) {
  const aActivity = Number(row.a_activity_count || 0)
  const bActivity = Number(row.b_activity_count || 0)
  if (aActivity !== bActivity) return aActivity > bActivity ? row.a_id : row.b_id
  return new Date(row.a_created_at).getTime() <= new Date(row.b_created_at).getTime() ? row.a_id : row.b_id
}

function taskSnapshot(row) {
  if (!row) return null
  return {
    issueKey: row.issue_key,
    issueKind: row.issue_kind,
    issueFingerprint: row.issue_fingerprint,
    assignedToId: row.assigned_to_id,
    assignedToName: row.assigned_to_name,
    dueAt: row.due_at,
    version: Number(row.version),
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function taskWithSla(row, now = new Date()) {
  const task = taskSnapshot(row)
  if (!task) return { assignmentStatus: 'unassigned', assignedTo: null, dueAt: null, slaStatus: 'unassigned', overdueHours: 0, escalationLevel: 0, taskVersion: 0 }
  const dueAt = new Date(task.dueAt)
  const remainingMs = dueAt.getTime() - now.getTime()
  const overdueHours = remainingMs < 0 ? Math.max(1, Math.ceil(Math.abs(remainingMs) / 3600000)) : 0
  const slaStatus = overdueHours ? 'overdue' : remainingMs <= 24 * 3600000 ? 'due_soon' : 'on_track'
  return {
    assignmentStatus: 'assigned',
    assignedTo: { id: task.assignedToId, name: task.assignedToName },
    dueAt: task.dueAt,
    slaStatus,
    overdueHours,
    escalationLevel: overdueHours >= 72 ? 2 : overdueHours ? 1 : 0,
    taskVersion: task.version,
    task,
  }
}

function assignmentPayload(task, now = new Date()) {
  if (!task) return null
  const dueAt = new Date(task.dueAt)
  const remainingMs = dueAt.getTime() - now.getTime()
  const overdueHours = remainingMs < 0 ? Math.max(1, Math.ceil(Math.abs(remainingMs) / 3600000)) : 0
  return {
    ...task,
    slaStatus: overdueHours ? 'overdue' : remainingMs <= 24 * 3600000 ? 'due_soon' : 'on_track',
    overdueHours,
    escalationLevel: overdueHours >= 72 ? 2 : overdueHours ? 1 : 0,
  }
}

function mapTaskEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    requestKey: row.request_key,
    issueKey: row.issue_key,
    issueKind: row.issue_kind,
    issueFingerprint: row.issue_fingerprint,
    action: row.action,
    reason: row.reason,
    before: row.before_snapshot,
    after: row.after_snapshot,
    actorId: row.actor_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }
}

function customerCandidate(row) {
  const signals = []
  if (row.a_tax_id && clean(row.a_tax_id).toUpperCase() === clean(row.b_tax_id).toUpperCase()) signals.push({ code: 'same_tax_id', label: '税号完全一致', weight: 100, value: row.a_tax_id })
  const aPhone = phoneDigits(row.a_phone); const bPhone = phoneDigits(row.b_phone)
  if (aPhone.length >= 7 && aPhone === bPhone) signals.push({ code: 'same_phone', label: '联系电话一致', weight: 85, value: aPhone })
  if (row.shared_contact_phone) signals.push({ code: 'same_contact_phone', label: '联系人电话一致', weight: 75, value: row.shared_contact_phone })
  if (normalizedName(row.a_name) && normalizedName(row.a_name) === normalizedName(row.b_name)) signals.push({ code: 'same_name', label: '客户名称一致', weight: 45, value: row.a_name })
  if (normalizedName(row.a_short_name) && normalizedName(row.a_short_name) === normalizedName(row.b_short_name)) signals.push({ code: 'same_short_name', label: '客户简称一致', weight: 35, value: row.a_short_name })
  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0))
  const survivorPartnerId = selectSurvivor(row)
  const retiredPartnerId = survivorPartnerId === row.a_id ? row.b_id : row.a_id
  const candidate = {
    issueKey: `customer_duplicate:${row.a_id}:${row.b_id}`,
    kind: 'customer_duplicate',
    severity: score >= 80 ? 'high' : 'medium',
    score,
    title: `疑似重复客户：${row.a_name} / ${row.b_name}`,
    explanation: signals.map((signal) => signal.label).join('、'),
    signals,
    candidateA: { id: row.a_id, partnerNo: row.a_partner_no, name: row.a_name, shortName: row.a_short_name, taxId: row.a_tax_id, phone: row.a_phone, version: row.a_version, activityCount: Number(row.a_activity_count), createdAt: row.a_created_at, updatedAt: row.a_updated_at },
    candidateB: { id: row.b_id, partnerNo: row.b_partner_no, name: row.b_name, shortName: row.b_short_name, taxId: row.b_tax_id, phone: row.b_phone, version: row.b_version, activityCount: Number(row.b_activity_count), createdAt: row.b_created_at, updatedAt: row.b_updated_at },
    recommendedAction: 'customer_merge_preview',
    previewRequest: { survivorPartnerId, retiredPartnerId },
  }
  candidate.fingerprint = fingerprint(candidate)
  return candidate
}

function vehicleCandidate(row) {
  const signals = []
  if (row.a_vin && row.a_vin === row.b_vin) signals.push({ code: 'same_vin', label: 'VIN 完全一致', weight: 100, value: row.a_vin })
  if (row.a_license_plate && row.a_license_plate.toUpperCase() === row.b_license_plate.toUpperCase()) signals.push({ code: 'same_license_plate', label: '车牌一致', weight: 85, value: row.a_license_plate })
  if (row.a_partner_id === row.b_partner_id && row.a_platform_master_id && row.a_platform_master_id === row.b_platform_master_id && normalizedName(row.a_vehicle_label) === normalizedName(row.b_vehicle_label)) signals.push({ code: 'same_owner_model', label: '同一客户且标准车型与名称一致', weight: 55, value: row.a_vehicle_label })
  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0))
  const sameOwner = row.a_partner_id === row.b_partner_id
  const survivorVehicleId = selectSurvivor(row)
  const retiredVehicleId = survivorVehicleId === row.a_id ? row.b_id : row.a_id
  const candidate = {
    issueKey: `vehicle_duplicate:${row.a_id}:${row.b_id}`,
    kind: 'vehicle_duplicate',
    severity: score >= 80 ? 'high' : 'medium',
    score,
    title: `疑似重复车辆：${row.a_vehicle_label} / ${row.b_vehicle_label}`,
    explanation: signals.map((signal) => signal.label).join('、'),
    signals,
    sameOwner,
    candidateA: { id: row.a_id, partnerId: row.a_partner_id, customerName: row.a_partner_name, vehicleLabel: row.a_vehicle_label, vin: row.a_vin, licensePlate: row.a_license_plate, platformMasterId: row.a_platform_master_id, variantMasterId: row.a_variant_master_id, version: row.a_version, activityCount: Number(row.a_activity_count), createdAt: row.a_created_at, updatedAt: row.a_updated_at },
    candidateB: { id: row.b_id, partnerId: row.b_partner_id, customerName: row.b_partner_name, vehicleLabel: row.b_vehicle_label, vin: row.b_vin, licensePlate: row.b_license_plate, platformMasterId: row.b_platform_master_id, variantMasterId: row.b_variant_master_id, version: row.b_version, activityCount: Number(row.b_activity_count), createdAt: row.b_created_at, updatedAt: row.b_updated_at },
    recommendedAction: sameOwner ? 'vehicle_merge_preview' : 'customer_identity_review',
    previewRequest: sameOwner ? { survivorVehicleId, retiredVehicleId } : { vehicleIds: [row.a_id, row.b_id], partnerIds: [row.a_partner_id, row.b_partner_id] },
  }
  candidate.fingerprint = fingerprint(candidate)
  return candidate
}

const customerCandidatesSql = `SELECT
  a.id a_id,a.partner_no a_partner_no,a.name a_name,a.short_name a_short_name,a.tax_id a_tax_id,a.phone a_phone,a.version a_version,a.created_at a_created_at,a.updated_at a_updated_at,
  b.id b_id,b.partner_no b_partner_no,b.name b_name,b.short_name b_short_name,b.tax_id b_tax_id,b.phone b_phone,b.version b_version,b.created_at b_created_at,b.updated_at b_updated_at,
  (SELECT regexp_replace(ca.phone,'[^0-9]','','g') FROM business_partner_contact ca JOIN business_partner_contact cb
    ON cb.partner_id=b.id AND length(regexp_replace(ca.phone,'[^0-9]','','g'))>=7
      AND regexp_replace(ca.phone,'[^0-9]','','g')=regexp_replace(cb.phone,'[^0-9]','','g')
    WHERE ca.partner_id=a.id ORDER BY ca.id,cb.id LIMIT 1) shared_contact_phone,
  ((SELECT count(*) FROM business_partner_contact c WHERE c.partner_id=a.id)+(SELECT count(*) FROM business_customer_vehicle v WHERE v.partner_id=a.id AND v.merged_into_vehicle_id IS NULL)+(SELECT count(*) FROM business_inquiry i WHERE i.customer_partner_id=a.id))::int a_activity_count,
  ((SELECT count(*) FROM business_partner_contact c WHERE c.partner_id=b.id)+(SELECT count(*) FROM business_customer_vehicle v WHERE v.partner_id=b.id AND v.merged_into_vehicle_id IS NULL)+(SELECT count(*) FROM business_inquiry i WHERE i.customer_partner_id=b.id))::int b_activity_count
FROM business_partner a JOIN business_partner b ON a.id<b.id
WHERE a.partner_type IN ('customer','both') AND b.partner_type IN ('customer','both')
  AND a.status='active' AND b.status='active' AND a.merged_into_partner_id IS NULL AND b.merged_into_partner_id IS NULL
  AND (
    (a.tax_id<>'' AND upper(trim(a.tax_id))=upper(trim(b.tax_id)))
    OR (length(regexp_replace(a.phone,'[^0-9]','','g'))>=7 AND regexp_replace(a.phone,'[^0-9]','','g')=regexp_replace(b.phone,'[^0-9]','','g'))
    OR (trim(a.name)<>'' AND lower(regexp_replace(a.name,'\\s','','g'))=lower(regexp_replace(b.name,'\\s','','g')))
    OR (trim(a.short_name)<>'' AND lower(regexp_replace(a.short_name,'\\s','','g'))=lower(regexp_replace(b.short_name,'\\s','','g')))
    OR EXISTS (SELECT 1 FROM business_partner_contact ca JOIN business_partner_contact cb
      ON cb.partner_id=b.id AND length(regexp_replace(ca.phone,'[^0-9]','','g'))>=7
        AND regexp_replace(ca.phone,'[^0-9]','','g')=regexp_replace(cb.phone,'[^0-9]','','g')
      WHERE ca.partner_id=a.id)
  )
ORDER BY a.id,b.id LIMIT 5000`

const vehicleCandidatesSql = `SELECT
  a.id a_id,a.partner_id a_partner_id,pa.name a_partner_name,a.vehicle_label a_vehicle_label,a.vin a_vin,a.license_plate a_license_plate,a.platform_master_id a_platform_master_id,a.variant_master_id a_variant_master_id,a.version a_version,a.created_at a_created_at,a.updated_at a_updated_at,
  b.id b_id,b.partner_id b_partner_id,pb.name b_partner_name,b.vehicle_label b_vehicle_label,b.vin b_vin,b.license_plate b_license_plate,b.platform_master_id b_platform_master_id,b.variant_master_id b_variant_master_id,b.version b_version,b.created_at b_created_at,b.updated_at b_updated_at,
  ((SELECT count(*) FROM business_inquiry i WHERE i.customer_vehicle_id=a.id)+(SELECT count(*) FROM business_sales_order s WHERE s.customer_vehicle_id=a.id)+(SELECT count(*) FROM business_quick_quote_draft d WHERE d.customer_vehicle_id=a.id))::int a_activity_count,
  ((SELECT count(*) FROM business_inquiry i WHERE i.customer_vehicle_id=b.id)+(SELECT count(*) FROM business_sales_order s WHERE s.customer_vehicle_id=b.id)+(SELECT count(*) FROM business_quick_quote_draft d WHERE d.customer_vehicle_id=b.id))::int b_activity_count
FROM business_customer_vehicle a
JOIN business_customer_vehicle b ON a.id<b.id
JOIN business_partner pa ON pa.id=a.partner_id
JOIN business_partner pb ON pb.id=b.partner_id
WHERE a.merged_into_vehicle_id IS NULL AND b.merged_into_vehicle_id IS NULL
  AND pa.status='active' AND pb.status='active' AND pa.merged_into_partner_id IS NULL AND pb.merged_into_partner_id IS NULL
  AND (
    (a.vin<>'' AND a.vin=b.vin)
    OR (a.license_plate<>'' AND upper(a.license_plate)=upper(b.license_plate))
    OR (a.partner_id=b.partner_id AND a.platform_master_id IS NOT NULL AND a.platform_master_id=b.platform_master_id AND lower(regexp_replace(a.vehicle_label,'\\s','','g'))=lower(regexp_replace(b.vehicle_label,'\\s','','g')))
  )
ORDER BY a.id,b.id LIMIT 5000`

function mapDecision(row) {
  if (!row) return null
  return { id: row.id, requestKey: row.request_key, issueKey: row.issue_key, issueKind: row.issue_kind, issueFingerprint: row.issue_fingerprint, decision: row.decision, reason: row.reason, deferredUntil: row.deferred_until, actorId: row.actor_id, actorName: row.actor_name, createdAt: row.created_at }
}

export function createBusinessMasterDataQualityRepository(pool) {
  async function scanCandidates(queryClient = pool) {
    const customers = await queryClient.query(customerCandidatesSql)
    const vehicles = await queryClient.query(vehicleCandidatesSql)
    return [...customers.rows.map(customerCandidate), ...vehicles.rows.map(vehicleCandidate)]
  }

  async function candidatesWithDecisions(queryClient = pool, now = new Date()) {
    const items = await scanCandidates(queryClient)
    if (!items.length) return items
    const issueKeys = items.map((item) => item.issueKey)
    const decisionRows = (await queryClient.query(`SELECT DISTINCT ON (issue_key) * FROM business_master_data_quality_decision
      WHERE issue_key=ANY($1::text[]) ORDER BY issue_key,created_at DESC,id DESC`, [items.map((item) => item.issueKey)])).rows
    const taskRows = (await queryClient.query('SELECT * FROM business_master_data_quality_task WHERE issue_key=ANY($1::text[])', [issueKeys])).rows
    const latest = new Map(decisionRows.map((row) => [row.issue_key, row]))
    const tasks = new Map(taskRows.map((row) => [row.issue_key, row]))
    return items.map((item) => {
      const row = latest.get(item.issueKey)
      const decision = row && row.issue_fingerprint === item.fingerprint ? mapDecision(row) : null
      const suppressed = Boolean(decision && (decision.decision === 'not_duplicate' || (decision.decision === 'deferred' && new Date(decision.deferredUntil).getTime() > now.getTime())))
      return { ...item, status: suppressed ? 'suppressed' : 'open', decision, ...taskWithSla(tasks.get(item.issueKey), now) }
    })
  }

  async function filteredCandidates({ kind = '', severity = '', query = '', assignedTo = '', slaStatus = '', now = new Date() } = {}) {
    const normalizedKind = clean(kind)
    if (normalizedKind && !issueKinds.has(normalizedKind)) throw problem('INVALID_MASTER_DATA_QUALITY_KIND', '资料质量问题类型无效')
    if (severity && !['high', 'medium'].includes(clean(severity))) throw problem('INVALID_MASTER_DATA_QUALITY_SEVERITY', '资料质量风险等级无效')
    const normalizedSlaStatus = clean(slaStatus)
    if (normalizedSlaStatus && !issueSlaStatuses.has(normalizedSlaStatus)) throw problem('INVALID_MASTER_DATA_QUALITY_SLA_STATUS', '资料质量处理时限状态无效')
    const term = clean(query).toLocaleLowerCase('zh-CN')
    let items = await candidatesWithDecisions(pool, now)
    if (normalizedKind) items = items.filter((item) => item.kind === normalizedKind)
    if (severity) items = items.filter((item) => item.severity === severity)
    if (clean(assignedTo)) items = items.filter((item) => [item.assignedTo?.id, item.assignedTo?.name].includes(clean(assignedTo)))
    if (normalizedSlaStatus) items = items.filter((item) => item.slaStatus === normalizedSlaStatus)
    if (term) items = items.filter((item) => JSON.stringify(item).toLocaleLowerCase('zh-CN').includes(term))
    items.sort((a, b) => b.score - a.score || a.issueKey.localeCompare(b.issueKey))
    return items
  }

  return {
    async list({ kind = '', status = 'open', severity = '', query = '', assignedTo = '', slaStatus = '', page = 1, pageSize = 30, now = new Date() } = {}) {
      const normalizedStatus = clean(status) || 'open'
      if (!issueStatuses.has(normalizedStatus)) throw problem('INVALID_MASTER_DATA_QUALITY_STATUS', '资料质量问题状态无效')
      const asOf = now instanceof Date ? now : new Date(now)
      if (Number.isNaN(asOf.getTime())) throw problem('INVALID_MASTER_DATA_QUALITY_AS_OF', '资料质量统计时间无效')
      let items = await filteredCandidates({ kind, severity, query, assignedTo, slaStatus, now: asOf })
      const summaryItems = items
      if (normalizedStatus !== 'all') items = items.filter((item) => item.status === normalizedStatus)
      const normalizedPage = boundedPage(page, 1, 100000)
      const normalizedPageSize = boundedPage(pageSize, 30, 100)
      const total = items.length
      const summary = {
        open: summaryItems.filter((item) => item.status === 'open').length,
        suppressed: summaryItems.filter((item) => item.status === 'suppressed').length,
        high: summaryItems.filter((item) => item.severity === 'high').length,
        medium: summaryItems.filter((item) => item.severity === 'medium').length,
        assigned: summaryItems.filter((item) => item.assignmentStatus === 'assigned').length,
        unassigned: summaryItems.filter((item) => item.assignmentStatus === 'unassigned').length,
        overdue: summaryItems.filter((item) => item.slaStatus === 'overdue').length,
        escalated: summaryItems.filter((item) => item.escalationLevel > 0).length,
        byKind: Object.fromEntries([...issueKinds].map((value) => [value, summaryItems.filter((item) => item.kind === value).length])),
      }
      return { asOf: asOf.toISOString(), items: items.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize), total, page: normalizedPage, pageSize: normalizedPageSize, summary }
    },

    async listOpenForOperations({ kind = '', query = '', assignedTo = '', now = new Date() } = {}) {
      const items = await filteredCandidates({ kind, query, assignedTo, now })
      return items.filter((item) => item.status === 'open')
    },

    async assign(issueKey, rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey)
      const normalizedIssueKey = clean(issueKey)
      if (!normalizedIssueKey || normalizedIssueKey.length > 500 || !/^(customer|vehicle)_duplicate:[^:]+:[^:]+$/.test(normalizedIssueKey)) throw problem('INVALID_MASTER_DATA_QUALITY_ISSUE', '资料质量问题编号无效')
      const submittedFingerprint = clean(rawInput.issueFingerprint)
      if (!/^[a-f0-9]{64}$/.test(submittedFingerprint)) throw problem('MASTER_DATA_QUALITY_FINGERPRINT_REQUIRED', '分配前必须提交当前问题指纹', 409)
      const assignedToId = identityValue(rawInput.assignedToId, '责任人编号', 128)
      const assignedToName = identityValue(rawInput.assignedToName, '责任人姓名', 160)
      const reason = clean(rawInput.reason)
      if (reason.length < 8 || reason.length > 500) throw problem('INVALID_MASTER_DATA_QUALITY_ASSIGNMENT_REASON', '分配原因必须为 8 至 500 个字符')
      const dueTimestamp = Date.parse(rawInput.dueAt)
      const maximumDueAt = Date.now() + 180 * 24 * 60 * 60 * 1000
      if (!Number.isFinite(dueTimestamp) || dueTimestamp <= Date.now() || dueTimestamp > maximumDueAt) throw problem('INVALID_MASTER_DATA_QUALITY_DUE_AT', '处理时限必须在未来 180 天内')
      const dueAt = new Date(dueTimestamp).toISOString()
      const expectedVersion = Number(rawInput.expectedVersion ?? 0)
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw problem('INVALID_MASTER_DATA_QUALITY_TASK_VERSION', 'expectedVersion 必须是非负整数')
      const by = actorDetails(actor)
      return withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-master-data-quality-assignment:${key}`])
        const repeated = (await client.query('SELECT * FROM business_master_data_quality_task_event WHERE request_key=$1', [key])).rows[0]
        if (repeated) {
          const after = repeated.after_snapshot
          if (repeated.issue_key !== normalizedIssueKey || repeated.issue_fingerprint !== submittedFingerprint || repeated.reason !== reason
            || after.assignedToId !== assignedToId || after.assignedToName !== assignedToName || new Date(after.dueAt).toISOString() !== dueAt) {
            throw problem('MASTER_DATA_QUALITY_ASSIGNMENT_REQUEST_KEY_CONFLICT', 'requestKey 已用于另一项资料质量分配', 409)
          }
          return { created: false, assignment: assignmentPayload(after), event: mapTaskEvent(repeated) }
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-master-data-quality-issue:${normalizedIssueKey}`])
        const [prefix, firstId, secondId] = normalizedIssueKey.split(':')
        const table = prefix === 'customer_duplicate' ? 'business_partner' : 'business_customer_vehicle'
        await client.query(`SELECT id FROM ${table} WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [[firstId, secondId]])
        const current = (await candidatesWithDecisions(client)).find((item) => item.issueKey === normalizedIssueKey)
        if (!current) throw problem('MASTER_DATA_QUALITY_ISSUE_NOT_FOUND', '该资料质量问题已不存在', 404)
        if (current.status !== 'open') throw problem('MASTER_DATA_QUALITY_ISSUE_SUPPRESSED', '该资料质量问题当前已处理或延期', 409)
        if (current.fingerprint !== submittedFingerprint) throw problem('MASTER_DATA_QUALITY_ISSUE_STALE', '候选资料已变化，请刷新质量队列', 409, { current })
        const existing = (await client.query('SELECT * FROM business_master_data_quality_task WHERE issue_key=$1 FOR UPDATE', [normalizedIssueKey])).rows[0]
        const currentVersion = Number(existing?.version || 0)
        if (expectedVersion !== currentVersion) throw problem('MASTER_DATA_QUALITY_TASK_STALE', '责任分配已被其他操作更新，请刷新后重试', 409, { current: existing ? assignmentPayload(taskSnapshot(existing)) : null })
        const action = !existing ? 'assigned'
          : existing.assigned_to_id !== assignedToId || existing.assigned_to_name !== assignedToName ? 'reassigned'
            : new Date(existing.due_at).toISOString() !== dueAt ? 'due_changed' : 'assignment_updated'
        const row = (await client.query(`INSERT INTO business_master_data_quality_task
          (issue_key,issue_kind,issue_fingerprint,assigned_to_id,assigned_to_name,due_at,version,created_by_id,created_by_name,updated_by_id,updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$7,$8)
          ON CONFLICT (issue_key) DO UPDATE SET issue_fingerprint=EXCLUDED.issue_fingerprint,assigned_to_id=EXCLUDED.assigned_to_id,
            assigned_to_name=EXCLUDED.assigned_to_name,due_at=EXCLUDED.due_at,version=business_master_data_quality_task.version+1,
            updated_by_id=EXCLUDED.updated_by_id,updated_by_name=EXCLUDED.updated_by_name,updated_at=now()
          RETURNING *`, [normalizedIssueKey, current.kind, current.fingerprint, assignedToId, assignedToName, dueAt, by.id, by.name])).rows[0]
        const before = taskSnapshot(existing)
        const after = taskSnapshot(row)
        const event = (await client.query(`INSERT INTO business_master_data_quality_task_event
          (id,request_key,issue_key,issue_kind,issue_fingerprint,action,reason,before_snapshot,after_snapshot,actor_id,actor_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11) RETURNING *`,
        [randomUUID(), key, current.issueKey, current.kind, current.fingerprint, action, reason, before ? JSON.stringify(before) : null, JSON.stringify(after), by.id, by.name])).rows[0]
        return { created: !existing, issue: current, assignment: assignmentPayload(after), event: mapTaskEvent(event) }
      })
    },

    async decide(issueKey, rawInput = {}, actor) {
      const key = requestKey(rawInput.requestKey)
      const normalizedIssueKey = clean(issueKey)
      const decision = clean(rawInput.decision)
      const reason = clean(rawInput.reason)
      if (!normalizedIssueKey || normalizedIssueKey.length > 500 || !/^(customer|vehicle)_duplicate:[^:]+:[^:]+$/.test(normalizedIssueKey)) throw problem('INVALID_MASTER_DATA_QUALITY_ISSUE', '资料质量问题编号无效')
      if (!decisions.has(decision)) throw problem('INVALID_MASTER_DATA_QUALITY_DECISION', '资料质量处理决定无效')
      if (reason.length < 8 || reason.length > 500) throw problem('INVALID_MASTER_DATA_QUALITY_REASON', '处理原因必须为 8 至 500 个字符')
      let deferredUntil = null
      if (decision === 'deferred') {
        const timestamp = Date.parse(rawInput.deferredUntil)
        const maximum = Date.now() + 180 * 24 * 60 * 60 * 1000
        if (!Number.isFinite(timestamp) || timestamp <= Date.now() || timestamp > maximum) throw problem('INVALID_MASTER_DATA_QUALITY_DEFERRED_UNTIL', '延后日期必须在未来 180 天内')
        deferredUntil = new Date(timestamp).toISOString()
      }
      const submittedFingerprint = clean(rawInput.issueFingerprint)
      if (!/^[a-f0-9]{64}$/.test(submittedFingerprint)) throw problem('MASTER_DATA_QUALITY_FINGERPRINT_REQUIRED', '处理前必须提交当前问题指纹', 409)
      const by = actorDetails(actor)
      return withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-master-data-quality:${key}`])
        const existing = (await client.query('SELECT * FROM business_master_data_quality_decision WHERE request_key=$1', [key])).rows[0]
        if (existing) {
          if (existing.issue_key !== normalizedIssueKey || existing.issue_fingerprint !== submittedFingerprint || existing.decision !== decision) throw problem('MASTER_DATA_QUALITY_REQUEST_KEY_CONFLICT', 'requestKey 已用于另一项资料质量决定', 409)
          return { created: false, item: existing.snapshot, decision: mapDecision(existing) }
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-master-data-quality-issue:${normalizedIssueKey}`])
        const [prefix, firstId, secondId] = normalizedIssueKey.split(':')
        const table = prefix === 'customer_duplicate' ? 'business_partner' : 'business_customer_vehicle'
        await client.query(`SELECT id FROM ${table} WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [[firstId, secondId]])
        const candidates = await scanCandidates(client)
        const current = candidates.find((item) => item.issueKey === normalizedIssueKey)
        if (!current) throw problem('MASTER_DATA_QUALITY_ISSUE_NOT_FOUND', '该资料质量问题已不存在', 404)
        if (current.fingerprint !== submittedFingerprint) throw problem('MASTER_DATA_QUALITY_ISSUE_STALE', '候选资料已变化，请刷新质量队列', 409, { current })
        const id = randomUUID()
        const row = (await client.query(`INSERT INTO business_master_data_quality_decision
          (id,request_key,issue_key,issue_kind,issue_fingerprint,decision,reason,deferred_until,snapshot,actor_id,actor_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,
        [id, key, current.issueKey, current.kind, current.fingerprint, decision, reason, deferredUntil, JSON.stringify(current), by.id, by.name])).rows[0]
        return { created: true, item: current, decision: mapDecision(row) }
      })
    },
  }
}
