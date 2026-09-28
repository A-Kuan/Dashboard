import { randomUUID } from 'node:crypto'
import { withTransaction } from './db.mjs'

function mapSku(row, oeRelations = [], fitments = []) {
  return {
    id: row.id,
    skuCode: row.sku_code,
    chineseName: row.chinese_name,
    brand: row.brand,
    category: row.category,
    subcategory: row.subcategory,
    manufacturerPartNumber: row.manufacturer_part_number,
    primaryOe: row.primary_oe,
    unit: row.unit,
    lifecycleStatus: row.lifecycle_status,
    barcode: row.barcode || '',
    imageUrl: row.image_url || '',
    dataSource: row.data_source || '',
    sourceEvidence: row.source_evidence,
    conflictResolution: row.conflict_resolution,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    oeRelations: oeRelations.map((item) => ({
      id: item.id, type: item.relation_type, oeNumber: item.oe_number, brand: item.brand,
      relation: item.relation, source: item.source, confidence: item.confidence,
    })),
    fitments: fitments.map((item) => ({
      id: item.id, vehicle: item.vehicle, years: item.years, engine: item.engine,
      body: item.body, condition: item.fitment_condition, source: item.source,
      verificationStatus: item.verification_status,
    })),
  }
}

export function createSkuRepository(pool) {
  async function childRows(client, skuId) {
    const [oe, fitments] = await Promise.all([
      client.query('SELECT * FROM sku_oe_relation WHERE sku_id = $1 ORDER BY sort_order, created_at', [skuId]),
      client.query('SELECT * FROM sku_fitment WHERE sku_id = $1 ORDER BY sort_order, created_at', [skuId]),
    ])
    return { oeRelations: oe.rows, fitments: fitments.rows }
  }

  async function replaceChildren(client, skuId, input) {
    await client.query('DELETE FROM sku_oe_relation WHERE sku_id = $1', [skuId])
    await client.query('DELETE FROM sku_fitment WHERE sku_id = $1', [skuId])
    for (const row of input.oeRelations) {
      await client.query(`INSERT INTO sku_oe_relation
        (id, sku_id, relation_type, oe_number, brand, relation, source, confidence, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), skuId, row.type, row.oeNumber, row.brand, row.relation, row.source, row.confidence, row.sortOrder])
    }
    for (const row of input.fitments) {
      await client.query(`INSERT INTO sku_fitment
        (id, sku_id, vehicle, years, engine, body, fitment_condition, source, verification_status, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), skuId, row.vehicle, row.years, row.engine, row.body, row.condition, row.source, row.verificationStatus, row.sortOrder])
    }
  }

  return {
    async list(query = '') {
      const term = String(query || '').trim().toLowerCase()
      const values = term ? [`%${term}%`] : []
      const where = term ? `WHERE lower(concat_ws(' ', s.sku_code, s.primary_oe, s.manufacturer_part_number,
        s.chinese_name, s.brand, s.category, s.subcategory)) LIKE $1
        OR EXISTS (SELECT 1 FROM sku_oe_relation oe WHERE oe.sku_id = s.id AND lower(oe.oe_number) LIKE $1)
        OR EXISTS (SELECT 1 FROM sku_fitment f WHERE f.sku_id = s.id AND lower(concat_ws(' ', f.vehicle, f.years, f.engine, f.body, f.fitment_condition)) LIKE $1)` : ''
      const { rows } = await pool.query(`SELECT s.*,
        (SELECT COUNT(*)::int FROM sku_fitment f WHERE f.sku_id = s.id) AS fitment_count
        FROM sku s ${where} ORDER BY s.updated_at DESC`, values)
      return rows.map((row) => ({ ...mapSku(row), fitmentCount: row.fitment_count }))
    },
    async get(id) {
      const { rows } = await pool.query('SELECT * FROM sku WHERE id = $1 OR sku_code = $1 LIMIT 1', [id])
      if (!rows[0]) return null
      const children = await childRows(pool, rows[0].id)
      return mapSku(rows[0], children.oeRelations, children.fitments)
    },
    async codeExists(code, exceptId = null) {
      const { rows } = await pool.query('SELECT EXISTS(SELECT 1 FROM sku WHERE sku_code = $1 AND ($2::text IS NULL OR id <> $2)) AS exists', [code, exceptId])
      return rows[0].exists
    },
    async create(input, actor = '张伟') {
      return withTransaction(pool, async (client) => {
        const id = randomUUID()
        const { rows } = await client.query(`INSERT INTO sku
          (id, sku_code, chinese_name, brand, category, subcategory, manufacturer_part_number,
           primary_oe, unit, lifecycle_status, barcode, image_url, data_source, source_evidence,
           conflict_resolution, created_by, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
        [id, input.skuCode, input.chineseName, input.brand, input.category, input.subcategory,
          input.manufacturerPartNumber, input.primaryOe, input.unit, input.lifecycleStatus,
          input.barcode || null, input.imageUrl || null, input.dataSource || null,
          input.sourceEvidence, input.conflictResolution, actor])
        await replaceChildren(client, id, input)
        const children = await childRows(client, id)
        return mapSku(rows[0], children.oeRelations, children.fitments)
      })
    },
    async update(id, input, actor = '张伟') {
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query(`UPDATE sku SET
          sku_code=$2, chinese_name=$3, brand=$4, category=$5, subcategory=$6,
          manufacturer_part_number=$7, primary_oe=$8, unit=$9, lifecycle_status=$10,
          barcode=$11, image_url=$12, data_source=$13, source_evidence=$14,
          conflict_resolution=$15, updated_by=$16, updated_at=now(), version=version+1
          WHERE id=$1 OR sku_code=$1 RETURNING *`,
        [id, input.skuCode, input.chineseName, input.brand, input.category, input.subcategory,
          input.manufacturerPartNumber, input.primaryOe, input.unit, input.lifecycleStatus,
          input.barcode || null, input.imageUrl || null, input.dataSource || null,
          input.sourceEvidence, input.conflictResolution, actor])
        if (!rows[0]) return null
        await replaceChildren(client, rows[0].id, input)
        const children = await childRows(client, rows[0].id)
        return mapSku(rows[0], children.oeRelations, children.fitments)
      })
    },
    async removeAll() {
      await pool.query('TRUNCATE TABLE sku CASCADE')
    },
  }
}
