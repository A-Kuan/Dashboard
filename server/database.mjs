import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'dashboard.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      contact TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      content TEXT NOT NULL, created_at TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS customer_activities_customer_date ON customer_activities(customer_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      category TEXT NOT NULL, brand TEXT NOT NULL, part_number TEXT NOT NULL,
      nature TEXT NOT NULL, origin TEXT NOT NULL, country TEXT NOT NULL,
      unit TEXT NOT NULL, specification TEXT NOT NULL, position TEXT NOT NULL,
      pack_quantity INTEGER NOT NULL, image_url TEXT NOT NULL, notes TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sku_numbers (
      sku_id TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      type TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY(sku_id,type,code)
    );
    CREATE TABLE IF NOT EXISTS sku_source (
      sku_id TEXT PRIMARY KEY REFERENCES skus(id) ON DELETE CASCADE,
      source_system TEXT NOT NULL, source_id TEXT NOT NULL,
      category_path TEXT NOT NULL, manufacturer TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(source_system,source_id)
    );
    CREATE INDEX IF NOT EXISTS sku_source_manufacturer_idx ON sku_source(manufacturer);
    CREATE TABLE IF NOT EXISTS fitments (
      id TEXT PRIMARY KEY, sku_id TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      make TEXT NOT NULL, series TEXT NOT NULL, chassis TEXT NOT NULL,
      year_from TEXT NOT NULL, year_to TEXT NOT NULL, power TEXT NOT NULL,
      engine TEXT NOT NULL, notes TEXT NOT NULL, verified INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_balances (
      sku_id TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      warehouse TEXT NOT NULL, bin TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0),
      PRIMARY KEY(sku_id,warehouse,bin)
    );
    CREATE TABLE IF NOT EXISTS customer_prices (
      sku_id TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0), updated_at TEXT NOT NULL,
      PRIMARY KEY(sku_id,customer_id)
    );
    CREATE TABLE IF NOT EXISTS supplier_quotes (
      id TEXT PRIMARY KEY, sku_id TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
      supplier TEXT NOT NULL, quoted_on TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
      notes TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS supplier_quotes_sku_date ON supplier_quotes(sku_id,quoted_on DESC,created_at DESC);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dictionary_groups (
      scope TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      editable INTEGER NOT NULL, status TEXT NOT NULL, maintenance_mode TEXT NOT NULL,
      sort_order INTEGER NOT NULL, source_id TEXT NOT NULL, source_json TEXT NOT NULL,
      PRIMARY KEY(scope,code)
    );
    CREATE TABLE IF NOT EXISTS dictionary_items (
      scope TEXT NOT NULL, dictionary_code TEXT NOT NULL, code TEXT NOT NULL,
      label TEXT NOT NULL, description TEXT NOT NULL, sort_order INTEGER NOT NULL,
      status TEXT NOT NULL, parent_code TEXT, metadata_json TEXT NOT NULL,
      navigation_rule_json TEXT NOT NULL, source_id TEXT NOT NULL, source_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(scope,dictionary_code,code),
      FOREIGN KEY(scope,dictionary_code) REFERENCES dictionary_groups(scope,code)
    );
    CREATE INDEX IF NOT EXISTS dictionary_items_list_idx ON dictionary_items(scope,dictionary_code,sort_order,code);
    CREATE TABLE IF NOT EXISTS dictionary_logos (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, dictionary_code TEXT NOT NULL,
      item_code TEXT NOT NULL, content BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      FOREIGN KEY(scope,dictionary_code,item_code) REFERENCES dictionary_items(scope,dictionary_code,code)
    );
    CREATE TABLE IF NOT EXISTS quote_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, customer TEXT NOT NULL, note TEXT NOT NULL,
      is_common INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quote_template_parts (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES quote_templates(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, vehicle TEXT NOT NULL, name TEXT NOT NULL,
      brand TEXT NOT NULL, note TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quote_template_parts_order_idx ON quote_template_parts(template_id,position);
    PRAGMA user_version = 1;
  `)
  const columns = (table) =>
    new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => column.name),
    )
  if (!columns('customers').has('customer_type'))
    db.exec("ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT '待分类'")
  if (!columns('customers').has('project_stage'))
    db.exec("ALTER TABLE customers ADD COLUMN project_stage TEXT NOT NULL DEFAULT '待跟进'")
  for (const name of ['trade_price_minor', 'repair_price_minor'])
    if (!columns('skus').has(name)) db.exec(`ALTER TABLE skus ADD COLUMN ${name} INTEGER`)
  db.exec('CREATE INDEX IF NOT EXISTS skus_enabled_code_idx ON skus(enabled,code)')
  db.exec('CREATE INDEX IF NOT EXISTS fitments_sku_series_idx ON fitments(sku_id,series)')
  db.exec('PRAGMA user_version = 5')
  return db
}

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
