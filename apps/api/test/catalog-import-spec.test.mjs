import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImportPreflightReport, catalogImportTemplateCsv, catalogImportTemplateSpec } from '../src/catalog-import-spec.mjs'

test('publishes a versioned import template with required and traceability fields', () => {
  assert.equal(catalogImportTemplateSpec.schemaVersion, 'catalog-import-template-v1')
  assert.equal(catalogImportTemplateSpec.maxRows, 500)
  assert.equal(catalogImportTemplateSpec.fields.find((field) => field.key === 'primaryOe').required, true)
  assert.equal(catalogImportTemplateSpec.fields.find((field) => field.key === 'sourceRecordId').recommended, true)
  const csv = catalogImportTemplateCsv()
  assert.match(csv, /^\uFEFF中文名称,英文名称/)
  assert.match(csv, /"Brake pad set, front"/)
  assert.match(csv, /来源记录ID/)
})

test('summarizes blocking issues, duplicate matches and source coverage', () => {
  const rows = [
    { state: 'ready', issues: [], duplicate_matches: [], normalized_payload: { identity: { brandLabel: 'Porsche OE', categoryLabel: '制动片' }, fitments: [{ vehicleLabel: 'Macan' }], evidence: [{ sourceSystem: 'PET', sourceRecordId: '1' }] } },
    { state: 'duplicate', issues: [{ code: 'MISSING_FITMENT', severity: 'warning', message: '适配车型待补充' }], duplicate_matches: [{ skuId: 'sku-1' }], normalized_payload: { identity: { brandLabel: 'Porsche OE', categoryLabel: '' }, fitments: [], evidence: [{ sourceSystem: '批量导入', sourceRecordId: '' }] } },
    { state: 'invalid', issues: [{ code: 'MISSING_PRIMARY_OE', severity: 'error', message: '缺少主 OE 编号' }], duplicate_matches: [], normalized_payload: { identity: {}, fitments: [], evidence: [{ sourceSystem: '批量导入', sourceRecordId: '' }] } },
  ]
  const report = buildImportPreflightReport(rows)
  assert.equal(report.decision, 'blocked')
  assert.equal(report.defaultSelectedRows, 1)
  assert.equal(report.selectableRows, 2)
  assert.equal(report.duplicateMatches, 1)
  assert.deepEqual(report.issueSummary.map((item) => item.code), ['MISSING_PRIMARY_OE', 'MISSING_FITMENT'])
  assert.equal(report.coverage.find((item) => item.field === 'sourceRecordId').percent, 33)
})

test('requires explicit review for unresolved supplier values', () => {
  const report = buildImportPreflightReport([
    { state: 'ready', issues: [], duplicate_matches: [], normalized_payload: { identity: { brandLabel: 'BOSCH' }, fitments: [], evidence: [] } },
    { state: 'review', issues: [{ code: 'VALUE_MAPPING_UNRESOLVED_BRAND', severity: 'review', message: '品牌值尚未映射' }], duplicate_matches: [], normalized_payload: { identity: { brandLabel: '神秘品牌' }, fitments: [], evidence: [] } },
  ])
  assert.equal(report.decision, 'review_required')
  assert.equal(report.defaultSelectedRows, 1)
  assert.equal(report.selectableRows, 2)
  assert.equal(report.reviewRows, 1)
})
