const path = require('path');
const fs = require('fs');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATABASE_URL = process.env.DATABASE_URL;

let db, dbAsync;

// Helper: convert SQLite ?-style placeholders to PostgreSQL $1,$2,... style
// If SQL already uses $N style, skip conversion
function toPostgres(sql) {
  if (/\$\d+/.test(sql)) return sql; // already PostgreSQL style
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

if (DATABASE_URL) {
  // ===== POSTGRESQL (Render production) =====
  console.log('🐘 PostgreSQL mode (Render)...');
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  pool.on('error', (err) => {
    console.error('⚠️ PG pool error:', err.message);
  });

  dbAsync = {
    all: async (sql, params = []) => {
      const pgSql = toPostgres(sql);
      try {
        const result = await pool.query(pgSql, params.length > 0 ? params : undefined);
        return result.rows;
      } catch (err) {
        console.error('dbAsync.all error:', err.message, '\nSQL:', pgSql, '\nParams:', params);
        throw err;
      }
    },
    get: async (sql, params = []) => {
      const pgSql = toPostgres(sql);
      try {
        const result = await pool.query(pgSql, params.length > 0 ? params : undefined);
        return result.rows[0] || null;
      } catch (err) {
        console.error('dbAsync.get error:', err.message, '\nSQL:', pgSql, '\nParams:', params);
        throw err;
      }
    },
    run: async (sql, params = []) => {
      let pgSql = toPostgres(sql);

      // SQLite → PostgreSQL syntax conversions
      pgSql = pgSql
        .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
        .replace(/\bDATETIME\s+DEFAULT\s+CURRENT_TIMESTAMP\b/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO')
        .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');

      // If it's an INSERT without RETURNING, add RETURNING * to get lastID safely
      const trimUpper = pgSql.trim().toUpperCase();
      if (trimUpper.startsWith('INSERT') && !trimUpper.includes('ON CONFLICT') && !trimUpper.includes('RETURNING')) {
        pgSql += ' RETURNING *';
      }

      try {
        const result = await pool.query(pgSql, params.length > 0 ? params : undefined);
        // Some tables use 'id', others use 'telegram_id' as primary key
        const lastID = result.rows && result.rows[0] ? (result.rows[0].id || null) : null;
        return { lastID, changes: result.rowCount };
      } catch (err) {
        if (err.code === '42701') return { lastID: null, changes: 0 }; // column already exists
        if (err.code === '42P07') return { lastID: null, changes: 0 }; // table already exists
        console.error('dbAsync.run error:', err.message, '\nSQL:', pgSql, '\nParams:', params);
        throw err;
      }

    }
  };

  // Legacy db shim for any old callback-style code
  db = {
    serialize: (fn) => fn(),
    run: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      dbAsync.run(sql, params || [])
        .then(r => { if (cb) cb.call({ lastID: r.lastID, changes: r.changes }, null); })
        .catch(err => { if (cb) cb(err); else console.error('db.run error:', err.message); });
    },
    get: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      dbAsync.get(sql, params || [])
        .then(r => { if (cb) cb(null, r); })
        .catch(err => { if (cb) cb(err, null); });
    },
    all: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      dbAsync.all(sql, params || [])
        .then(r => { if (cb) cb(null, r); })
        .catch(err => { if (cb) cb(err, []); });
    }
  };

  // Initialize schema + seed data (async, non-blocking)
  initPg().catch(err => console.error('initPg error:', err.message));

} else {
  // ===== SQLITE (local development) =====
  console.log('📦 SQLite mode (local)...');
  const sqlite3 = require('sqlite3').verbose();

  const dbDir = path.join(__dirname);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(__dirname, 'beauty_market.db');
  const sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('⚠️ SQLite error:', err.message);
    else console.log('✅ SQLite connected:', dbPath);
  });

  db = sqliteDb;

  dbAsync = {
    all: (sql, params = []) => new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    }),
    run: (sql, params = []) => new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    })
  };

  sqliteDb.serialize(() => {
    initSqlite(sqliteDb);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL schema + seed
// ─────────────────────────────────────────────────────────────────────────────
async function initPg() {
  console.log('🔧 Creating PostgreSQL tables...');

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    full_name TEXT,
    role TEXT DEFAULT 'USER',
    language TEXT DEFAULT 'uz',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    owner_telegram_id TEXT,
    store_name TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    commission_margin REAL DEFAULT 10.0,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS store_subscriptions (
    id SERIAL PRIMARY KEY,
    user_telegram_id TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_telegram_id, store_id)
  )`);

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL,
    title_uz TEXT NOT NULL,
    title_ru TEXT NOT NULL,
    description_uz TEXT,
    description_ru TEXT,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    sizes TEXT,
    image_url TEXT,
    images_json TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_telegram_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_note TEXT,
    store_id INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    total_price REAL NOT NULL,
    commission_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS payouts (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    status TEXT DEFAULT 'COMPLETED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbAsync.run(`CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    user_telegram_id TEXT,
    user_name TEXT,
    rating INTEGER DEFAULT 5,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Super admin user (upsert)
  const { Pool } = require('pg');
  const pool = new (Pool)({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query(
    `INSERT INTO users (telegram_id, username, full_name, role, language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id) DO UPDATE SET role = 'SUPER_ADMIN'`,
    ['1812245206', 'Muhammadyusuf', 'Muhammadyusuf (Super Admin)', 'SUPER_ADMIN', 'uz']
  );
  await pool.end();

  // Seed only if empty
  const countRow = await dbAsync.get('SELECT COUNT(*) as count FROM stores');
  const storeCount = parseInt(countRow?.count || 0);
  if (storeCount === 0) {
    console.log('🌱 Seeding initial data...');
    await seedPg();
  } else {
    console.log(`✅ DB ready with ${storeCount} stores.`);
  }
}

async function seedPg() {
  const { Pool } = require('pg');
  const pool = new (Pool)({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  await pool.query(
    `INSERT INTO users (telegram_id, username, full_name, role, language) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    ['8888888', 'beauty_owner', "Zuhra Do'kon Egasi", 'ADMIN', 'uz']
  );

  const s1 = await pool.query(
    `INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    ['8888888', 'Rose Beauty & Perfume Boutique', 'Luks parfyumeriya va teri parvarish kosmetikasi',
     'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80', 12.0]
  );
  const store1Id = s1.rows[0].id;

  await pool.query(
    `INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [store1Id, "Fransuz Atiri 'Rose Elixir' 50ml", "Французские Духи 'Rose Elixir' 50мл",
     'Yuqori sifatli fransuz atiri.', 'Высококачественные французские духи.',
     450000, 'Parfyum', '["50ml","100ml"]',
     'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80',
     '["https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80"]']
  );

  await pool.query(
    `INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [store1Id, "Namlantiruvchi Yuz Kremi 'Hydra Glow'", "Увлажняющий Крем 'Hydra Glow'",
     'Gialuron kislotali krem.', 'Крем с гиалуроновой кислотой.',
     180000, 'Teri parvarishi', '["50g"]',
     'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=450&q=80',
     '["https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=450&q=80"]']
  );

  await pool.end();
  console.log('✅ Seed complete!');
}

// ─────────────────────────────────────────────────────────────────────────────
// SQLite schema + seed (local dev)
// ─────────────────────────────────────────────────────────────────────────────
function initSqlite(sqliteDb) {
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (telegram_id TEXT PRIMARY KEY, username TEXT, full_name TEXT, role TEXT DEFAULT 'USER', language TEXT DEFAULT 'uz', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_telegram_id TEXT, store_name TEXT NOT NULL, description TEXT, logo_url TEXT, commission_margin REAL DEFAULT 10.0, status TEXT DEFAULT 'ACTIVE', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS store_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_telegram_id TEXT NOT NULL, store_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_telegram_id, store_id))`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, title_uz TEXT NOT NULL, title_ru TEXT NOT NULL, description_uz TEXT, description_ru TEXT, price REAL NOT NULL, category TEXT NOT NULL, sizes TEXT, image_url TEXT, images_json TEXT, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_telegram_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_note TEXT, store_id INTEGER NOT NULL, items_json TEXT NOT NULL, total_price REAL NOT NULL, commission_amount REAL DEFAULT 0, status TEXT DEFAULT 'PENDING', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, amount REAL NOT NULL, note TEXT, status TEXT DEFAULT 'COMPLETED', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_telegram_id TEXT, user_name TEXT, rating INTEGER DEFAULT 5, comment TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES ('1812245206', 'Muhammadyusuf', 'Muhammadyusuf (Super Admin)', 'SUPER_ADMIN', 'uz')`);
  sqliteDb.get("SELECT COUNT(*) as count FROM stores", (err, row) => {
    if (err || (row && row.count > 0)) return;
    sqliteDb.run(`INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES ('8888888', 'beauty_owner', 'Zuhra Do''kon Egasi', 'ADMIN', 'uz')`);
    sqliteDb.run(`INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin) VALUES ('8888888', 'Rose Beauty & Perfume Boutique', 'Luks parfyumeriya', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80', 12.0)`, function(err) {
      if (!err) {
        sqliteDb.run(`INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json) VALUES (${this.lastID},'Fransuz Atiri','Французские Духи','Yuqori sifat','Высокое качество',450000,'Parfyum','["50ml"]','https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80','[]')`);
      }
    });
  });
}

module.exports = { db, dbAsync };
