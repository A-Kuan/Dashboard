import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database.mjs'

test('old customer and SKU data survives price schema migration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-migration-test-'))
  let db
  try {
    const legacy = new DatabaseSync(join(directory, 'dashboard.sqlite'))
    legacy.exec(`
      CREATE TABLE customers (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
        contact TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL,
        enabled INTEGER NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE skus (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
        category TEXT NOT NULL, brand TEXT NOT NULL, part_number TEXT NOT NULL,
        nature TEXT NOT NULL, origin TEXT NOT NULL, country TEXT NOT NULL,
        unit TEXT NOT NULL, specification TEXT NOT NULL, position TEXT NOT NULL,
        pack_quantity INTEGER NOT NULL, image_url TEXT NOT NULL, notes TEXT NOT NULL,
        enabled INTEGER NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO customers VALUES ('c1','OLD-C','旧客户','','','',1,1,'2026-01-01');
      INSERT INTO skus VALUES ('s1','OLD-S','旧配件','滤清系统','旧品牌','','品牌件','国产','','个','','',1,'','',1,1,'2026-01-01');
    `)
    legacy.close()
    db = openDatabase(directory)
    assert.equal(
      db.prepare('SELECT customer_type FROM customers WHERE id=?').get('c1').customer_type,
      '待分类',
    )
    assert.equal(
      db.prepare('SELECT project_stage FROM customers WHERE id=?').get('c1').project_stage,
      '待跟进',
    )
    assert.equal(db.prepare('SELECT address FROM customers WHERE id=?').get('c1').address, '')
    assert.equal(
      db.prepare('SELECT trade_price_minor,repair_price_minor FROM skus WHERE id=?').get('s1')
        .trade_price_minor,
      null,
    )
    assert.equal(db.prepare('SELECT name FROM skus WHERE id=?').get('s1').name, '旧配件')
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='supplier_quotes'").get())
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='customer_contacts'").get())
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE name='customer_vehicle_owners'").get(),
    )
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='customer_vehicles'").get())
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='customer_inquiries'").get())
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE name='customer_inquiry_items'").get(),
    )
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9)
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM dictionary_groups WHERE scope='configuration' ORDER BY sort_order",
        )
        .all()
        .map((row) => row.name),
      ['客户类型', '客户跟进阶段'],
    )
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
