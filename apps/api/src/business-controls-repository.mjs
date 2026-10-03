import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'
import { normalizeBusinessControls, readBusinessControls } from './business-quote-policy.mjs'

function clean(value) { return String(value ?? '').trim() }
function problem(errorCode, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { errorCode, statusCode, ...(details ? { details } : {}) })
}

function mapEvent(row) {
  return { id: row.id, action: row.action, fromVersion: row.from_version, toVersion: row.to_version, actorId: row.actor_id, actorName: row.actor_name, note: row.note, before: row.before_snapshot, after: row.after_snapshot, createdAt: row.created_at }
}

export function createBusinessControlsRepository(pool) {
  async function get(client = pool) {
    const configuration = await readBusinessControls(client)
    const events = (await client.query('SELECT * FROM business_control_event ORDER BY created_at DESC,id DESC LIMIT 50')).rows.map(mapEvent)
    return { ...configuration, events }
  }

  return {
    get,
    async update(rawInput = {}, actor) {
      await withTransaction(pool, async (client) => {
        const current = await readBusinessControls(client, { lock: 'update' })
        const expectedVersion = Number(rawInput.expectedVersion)
        if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) throw problem('BUSINESS_CONTROLS_VERSION_CONFLICT', '业务控制规则已被其他操作更新，请刷新后重试', 409, { currentVersion: current.version })
        const controls = normalizeBusinessControls({ ...current.controls, ...Object.fromEntries(['marginControlEnabled', 'minimumMarginRate', 'creditControlEnabled'].filter((key) => rawInput[key] !== undefined).map((key) => [key, rawInput[key]])) })
        const actorId = clean(actor?.id)
        const actorName = clean(actor?.name) || '系统操作员'
        const nextVersion = current.version + 1
        await client.query(`UPDATE app_configuration SET payload=$1::jsonb,version=$2,updated_by=$3,updated_at=now() WHERE key='business_controls'`, [JSON.stringify(controls), nextVersion, actorId])
        await client.query(`INSERT INTO business_control_event (id,action,from_version,to_version,actor_id,actor_name,note,before_snapshot,after_snapshot)
          VALUES ($1,'updated',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`, [randomUUID(), current.version, nextVersion, actorId, actorName, clean(rawInput.note), JSON.stringify(current.controls), JSON.stringify(controls)])
      })
      return get()
    },
  }
}
