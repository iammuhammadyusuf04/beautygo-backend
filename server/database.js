const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// ===================================================
// DATABASE: PostgreSQL (production) va SQLite (local)
// ===================================================
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATABASE_URL = process.env.DATABASE_URL;

let db, dbAsync;

if (DATABASE_URL || IS_PRODUCTION) {
  // ===== POSTGRESQL (Render production) =====
  console.log('🐘 PostgreSQL rejimida ishlamoqda...');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  pool.on('error', (err) => {
    console.error('⚠️ PostgreSQL pool xatosi:', err.message);
  });

  // PostgreSQL uchun dbAsync wrapper
  dbAsync = {
    all: async (sql, params = []) => {
      // SQLite ?-parametrlarni PostgreSQL $1,$2,... ga o'tkazish
      const pgSql = sql.replace(/\?/g, (_, i) => {
        const idx = params.indexOf(params[sql.split('?').slice(0, sql.split('?').length - (sql.split('?').length - sql.split('?').indexOf('?') - 1)).length - 1]);
        return `$${(pgSql_idx = (pgSql_idx || 0) + 1)}`;
      });
      // Simpler approach: convert ? placeholders to $1, $2, ...
      let counter = 0;
      const convertedSql = sql.replace(/\?/g, () => `$${++counter}`);
      const pgParams = params.map(p => {
        if (p === null || p === undefined) return null;
        return p;
      });
      try {
        const result = await pool.query(convertedSql, pgParams.length > 0 ? pgParams : undefined);
        return result.rows;
      } catch (err) {
        console.error('DB.all error:', err.message, '\nSQL:', sql);
        throw err;
      }
    },
    get: async (sql, params = []) => {
      let counter = 0;
      const convertedSql = sql.replace(/\?/g, () => `$${++counter}`);
      try {
        const result = await pool.query(convertedSql, params.length > 0 ? params : undefined);
        return result.rows[0] || null;
      } catch (err) {
        console.error('DB.get error:', err.message, '\nSQL:', sql);
        throw err;
      }
    },
    run: async (sql, params = []) => {
      let counter = 0;
      // PostgreSQL da AUTOINCREMENT o'rniga SERIAL ishlatiladi
      // LAST_INSERT_ROWID o'rniga RETURNING id ishlatamiz
      let convertedSql = sql.replace(/\?/g, () => `$${++counter}`);

      // INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY (schema creation)
      convertedSql = convertedSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
      convertedSql = convertedSql.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

      // REPLACE INTO → INSERT ... ON CONFLICT
      if (convertedSql.trim().toUpperCase().startsWith('INSERT OR REPLACE')) {
        convertedSql = convertedSql.replace(/^INSERT OR REPLACE/i, 'INSERT');
        // Add ON CONFLICT DO NOTHING or DO UPDATE
        if (!convertedSql.includes('ON CONFLICT')) {
          convertedSql += ' ON CONFLICT DO NOTHING';
        }
      }

      // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
      if (convertedSql.trim().toUpperCase().startsWith('INSERT OR IGNORE')) {
        convertedSql = convertedSql.replace(/^INSERT OR IGNORE/i, 'INSERT');
        if (!convertedSql.includes('ON CONFLICT')) {
          convertedSql += ' ON CONFLICT DO NOTHING';
        }
      }

      // Add RETURNING id to INSERT statements for lastID
      let returningId = false;
      if (convertedSql.trim().toUpperCase().startsWith('INSERT') && !convertedSql.includes('RETURNING')) {
        convertedSql += ' RETURNING id';
        returningId = true;
      }

      try {
        const result = await pool.query(convertedSql, params.length > 0 ? params : undefined);
        const lastID = returningId && result.rows[0] ? result.rows[0].id : null;
        return { lastID, changes: result.rowCount };
      } catch (err) {
        // Ignore column-already-exists errors (ALTER TABLE ADD COLUMN)
        if (err.code === '42701') return { lastID: null, changes: 0 }; // column already exists
        console.error('DB.run error:', err.message, '\nSQL:', convertedSql);
        throw err;
      }
    }
  };

  // db compatibility shim (legacy code uchun)
  db = {
    serialize: (fn) => fn(),
    run: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      dbAsync.run(sql, params || []).then(r => {
        if (cb) cb.call({ lastID: r.lastID, changes: r.changes }, null);
      }).catch(err => {
        if (cb) cb(err);
        else console.error('db.run silent error:', err.message);
      });
    },
    get: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      dbAsync.get(sql, params || []).then(r => {
        if (cb) cb(null, r);
      }).catch(err => {
        if (cb) cb(err, null);
      });
    },
    all: (sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      dbAsync.all(sql, params || []).then(r => {
        if (cb) cb(null, r);
      }).catch(err => {
        if (cb) cb(err, []);
      });
    }
  };

  // Schema yaratish va seed qilish
  initializeDatabase();

} else {
  // ===== SQLITE (local development) =====
  console.log('📦 SQLite rejimida ishlamoqda (local development)...');
  const sqlite3 = require('sqlite3').verbose();

  const dbDir = path.dirname(path.join(__dirname, 'beauty_market.db'));
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(__dirname, 'beauty_market.db');
  const sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('⚠️ SQLite DB Open Warning:', err.message);
    else console.log('✅ SQLite DB Connected!');
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
      sqliteDb.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    })
  };

  sqliteDb.serialize(() => {
    initializeTables(sqliteDb);
  });
}

// ===== SCHEMA INITIALIZATION =====
async function initializeDatabase() {
  try {
    console.log('🔧 Database schema yaratilmoqda...');
    await initializeTablesAsync();
    await seedInitialDataAsync();
    console.log('✅ Database tayyor!');
  } catch (err) {
    console.error('⚠️ Database init error:', err.message);
  }
}

async function initializeTablesAsync() {
  // Users table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      full_name TEXT,
      role TEXT DEFAULT 'USER',
      language TEXT DEFAULT 'uz',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Stores table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      owner_telegram_id TEXT,
      store_name TEXT NOT NULL,
      description TEXT,
      logo_url TEXT,
      commission_margin REAL DEFAULT 10.0,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Store Subscriptions table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS store_subscriptions (
      id SERIAL PRIMARY KEY,
      user_telegram_id TEXT NOT NULL,
      store_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_telegram_id, store_id)
    )
  `);

  // Products table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS products (
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
    )
  `);

  // Orders table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS orders (
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
    )
  `);

  // Payouts table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS payouts (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'COMPLETED',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Reviews table
  await dbAsync.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      user_telegram_id TEXT,
      user_name TEXT,
      rating INTEGER DEFAULT 5,
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Super admin user
  await dbAsync.run(
    `INSERT INTO users (telegram_id, username, full_name, role, language) 
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (telegram_id) DO UPDATE SET role = 'SUPER_ADMIN'`,
    ['1812245206', 'Muhammadyusuf', 'Muhammadyusuf (Super Admin)', 'SUPER_ADMIN', 'uz']
  );
}

async function seedInitialDataAsync() {
  try {
    const countResult = await dbAsync.get('SELECT COUNT(*) as count FROM stores');
    const count = parseInt(countResult?.count || 0);
    if (count > 0) {
      console.log(`ℹ️ Database allaqachon ${count} ta do'kon bilan to'ldirilgan`);
      return;
    }

    console.log('🌱 Boshlang\'ich ma\'lumotlar yuklanmoqda...');

    // Sample store 1
    await dbAsync.run(
      `INSERT INTO users (telegram_id, username, full_name, role, language) 
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (telegram_id) DO NOTHING`,
      ['8888888', 'beauty_owner', "Zuhra Do'kon Egasi", 'ADMIN', 'uz']
    );

    const store1 = await dbAsync.run(
      `INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin) 
       VALUES ($1, $2, $3, $4, $5)`,
      ['8888888', 'Rose Beauty & Perfume Boutique', 'Luks parfyumeriya va teri parvarish kosmetikasi',
       'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80', 12.0]
    );

    const store1Id = store1.lastID;

    const products1 = [
      {
        title_uz: "Fransuz Atiri 'Rose Elixir' 50ml", title_ru: "Французские Духи 'Rose Elixir' 50мл",
        desc_uz: 'Yuqori sifatli fransuz atiri.', desc_ru: 'Высококачественные французские духи.',
        price: 450000, category: 'Parfyum',
        sizes: JSON.stringify(['50ml', '100ml']),
        image_url: 'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80',
        images_json: JSON.stringify(['https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80'])
      },
      {
        title_uz: "Namlantiruvchi Yuz Kremi 'Hydra Glow'", title_ru: "Увлажняющий Крем 'Hydra Glow'",
        desc_uz: 'Gialuron kislotali krem.', desc_ru: 'Крем с гиалуроновой кислотой.',
        price: 180000, category: 'Teri parvarishi',
        sizes: JSON.stringify(['50g']),
        image_url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=450&q=80',
        images_json: JSON.stringify(['https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=450&q=80'])
      }
    ];

    for (const p of products1) {
      await dbAsync.run(
        `INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [store1Id, p.title_uz, p.title_ru, p.desc_uz, p.desc_ru, p.price, p.category, p.sizes, p.image_url, p.images_json]
      );
    }

    console.log('✅ Boshlang\'ich ma\'lumotlar yuklandi!');
  } catch (err) {
    console.error('⚠️ Seed error:', err.message);
  }
}

// SQLite uchun initializeTables (legacy)
function initializeTables(sqliteDb) {
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (telegram_id TEXT PRIMARY KEY, username TEXT, full_name TEXT, role TEXT DEFAULT 'USER', language TEXT DEFAULT 'uz', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_telegram_id TEXT, store_name TEXT NOT NULL, description TEXT, logo_url TEXT, commission_margin REAL DEFAULT 10.0, status TEXT DEFAULT 'ACTIVE', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS store_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_telegram_id TEXT NOT NULL, store_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_telegram_id, store_id))`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, title_uz TEXT NOT NULL, title_ru TEXT NOT NULL, description_uz TEXT, description_ru TEXT, price REAL NOT NULL, category TEXT NOT NULL, sizes TEXT, image_url TEXT, images_json TEXT, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_telegram_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_note TEXT, store_id INTEGER NOT NULL, items_json TEXT NOT NULL, total_price REAL NOT NULL, commission_amount REAL DEFAULT 0, status TEXT DEFAULT 'PENDING', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, amount REAL NOT NULL, note TEXT, status TEXT DEFAULT 'COMPLETED', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_telegram_id TEXT, user_name TEXT, rating INTEGER DEFAULT 5, comment TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  sqliteDb.run("INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES ('1812245206', 'Muhammadyusuf', 'Muhammadyusuf (Super Admin)', 'SUPER_ADMIN', 'uz')");
  seedInitialDataSQLite(sqliteDb);
}

function seedInitialDataSQLite(sqliteDb) {
  sqliteDb.get("SELECT COUNT(*) as count FROM stores", (err, row) => {
    if (err || (row && row.count > 0)) return;
    sqliteDb.run("INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES ('8888888', 'beauty_owner', 'Zuhra Do''kon Egasi', 'ADMIN', 'uz')");
    sqliteDb.run(`INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin) VALUES ('8888888', 'Rose Beauty & Perfume Boutique', 'Luks parfyumeriya', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80', 12.0)`, function(err) {
      if (err) return;
      const storeId = this.lastID;
      sqliteDb.run(`INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json) VALUES (${storeId}, 'Fransuz Atiri', 'Французские Духи', 'Yuqori sifat', 'Высокое качество', 450000, 'Parfyum', '["50ml"]', 'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80', '[]')`);
    });
  });
}

module.exports = { db, dbAsync };
