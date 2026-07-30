const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'beauty_market.db');
const db = new sqlite3.Database(dbPath);

// Initialize Tables & Auto-Migrations
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      full_name TEXT,
      role TEXT DEFAULT 'USER',
      language TEXT DEFAULT 'uz',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Stores table
  db.run(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_telegram_id TEXT,
      store_name TEXT NOT NULL,
      description TEXT,
      logo_url TEXT,
      commission_margin REAL DEFAULT 10.0,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Store Subscriptions table
  db.run(`
    CREATE TABLE IF NOT EXISTS store_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_telegram_id TEXT NOT NULL,
      store_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_telegram_id, store_id)
    )
  `);

  // Products table
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id)
    )
  `);

  // Auto-migration: Check if images_json column exists
  db.run("ALTER TABLE products ADD COLUMN images_json TEXT", (err) => {});

  // Orders table
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_telegram_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_note TEXT,
      store_id INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      total_price REAL NOT NULL,
      commission_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Auto-migration: Check if customer_note column exists
  db.run("ALTER TABLE orders ADD COLUMN customer_note TEXT", (err) => {});

  // Payouts table
  db.run(`
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'COMPLETED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Reviews table
  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      user_telegram_id TEXT,
      user_name TEXT,
      rating INTEGER DEFAULT 5,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Auto-promote Telegram ID 1812245206 to SUPER_ADMIN
  db.run(
    "INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES (?, ?, ?, ?, ?)",
    ['1812245206', 'Muhammadyusuf', 'Muhammadyusuf (Super Admin)', 'SUPER_ADMIN', 'uz']
  );

  seedInitialData();
});

function seedInitialData() {
  db.get("SELECT COUNT(*) as count FROM stores", (err, row) => {
    if (err) return;
    if (!row || row.count === 0) {

      db.run(
        "INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES (?, ?, ?, ?, ?)",
        ['1812245206', 'Muhammadyusuf', 'Muhammadyusuf (Super Admin)', 'SUPER_ADMIN', 'uz']
      );

      db.run(
        "INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, language) VALUES (?, ?, ?, ?, ?)",
        ['8888888', 'beauty_owner', "Zuhra Do'kon Egasi", 'ADMIN', 'uz']
      );

      db.run(
        `INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin) 
         VALUES ('8888888', 'Rose Beauty & Perfume Boutique', 'Luks parfyumeriya va teri parvarish kosmetikasi', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80', 12.0)`,
        function (err) {
          if (err) return;
          const store1Id = this.lastID;

          const sampleProducts = [
            {
              title_uz: "Fransuz Atiri 'Rose Elixir' 50ml",
              title_ru: "Французские Духи 'Rose Elixir' 50мл",
              desc_uz: "Yuqori sifatli fransuz atiri, uzoq saqlanuvchi nafis gul ifori.",
              desc_ru: "Высококачественные французские духи с долгоиграющим ароматом.",
              price: 450000,
              category: "Parfyum",
              sizes: JSON.stringify(["50ml", "100ml"]),
              image_url: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80",
              images_json: JSON.stringify([
                "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80",
                "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=450&q=80"
              ])
            },
            {
              title_uz: "Namlantiruvchi Yuz Kremi 'Hydra Glow'",
              title_ru: "Увлажняющий Крем Для Лица 'Hydra Glow'",
              desc_uz: "Gialuron kislotali va vitaminli yuzni oziqlantiruvchi krem.",
              desc_ru: "Питательный крем для лица с гиалуроновой кислотой.",
              price: 180000,
              category: "Teri parvarishi",
              sizes: JSON.stringify(["50g"]),
              image_url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=450&q=80",
              images_json: JSON.stringify([
                "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=450&q=80",
                "https://images.unsplash.com/photo-1608248597263-0057e42d76f8?auto=format&fit=crop&w=450&q=80"
              ])
            },
            {
              title_uz: "Luks Lab Bo'yog'i 'Velvet Matte Rose'",
              title_ru: "Люксовая Помада 'Velvet Matte Rose'",
              desc_uz: "Yumshoq kadife teksturali, uzoq saqlanuvchi lab bo'yog'i.",
              desc_ru: "Матовая губная помада с бархатистой текстурой.",
              price: 120000,
              category: "Kosmetika",
              sizes: JSON.stringify(["#01 Classic Red", "#05 Soft Nude"]),
              image_url: "https://images.unsplash.com/photo-1586495777744-4413f21062fa?auto=format&fit=crop&w=450&q=80",
              images_json: JSON.stringify([
                "https://images.unsplash.com/photo-1586495777744-4413f21062fa?auto=format&fit=crop&w=450&q=80",
                "https://images.unsplash.com/photo-1625093742435-6fa192b6fb10?auto=format&fit=crop&w=450&q=80"
              ])
            }
          ];

          sampleProducts.forEach(p => {
            db.run(
              `INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [store1Id, p.title_uz, p.title_ru, p.desc_uz, p.desc_ru, p.price, p.category, p.sizes, p.image_url, p.images_json]
            );
          });
        }
      );

      db.run(
        `INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin) 
         VALUES ('1812245206', 'Silk & Elegance Fashion', 'Ayollar uchun zamonaviy va nafis kiyimlar', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=200&q=80', 10.0)`,
        function (err) {
          if (err) return;
          const store2Id = this.lastID;

          const fashionProducts = [
            {
              title_uz: "Ipak Ko'ylak 'Elegance Evening'",
              title_ru: "Шелковое Платье 'Elegance Evening'",
              desc_uz: "Tabiiy ipakdan tikilgan, nafis oqshom ko'ylagi.",
              desc_ru: "Вечернее платье из натурального шелка.",
              price: 650000,
              category: "Kiyimlar",
              sizes: JSON.stringify(["S", "M", "L"]),
              image_url: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=450&q=80",
              images_json: JSON.stringify([
                "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=450&q=80",
                "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=450&q=80"
              ])
            },
            {
              title_uz: "Zamonaviy Ayollar Kostyumi 'Pink Power'",
              title_ru: "Современный Женский Костюм 'Pink Power'",
              desc_uz: "Yuqori sifatli matodan tiktirilgan biznes va bayramona kostyum.",
              desc_ru: "Стильный женский костюм высокого качества.",
              price: 890000,
              category: "Kiyimlar",
              sizes: JSON.stringify(["S", "M", "XL"]),
              image_url: "https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=450&q=80",
              images_json: JSON.stringify([
                "https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=450&q=80",
                "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=450&q=80"
              ])
            }
          ];

          fashionProducts.forEach(p => {
            db.run(
              `INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [store2Id, p.title_uz, p.title_ru, p.desc_uz, p.desc_ru, p.price, p.category, p.sizes, p.image_url, p.images_json]
            );
          });
        }
      );
    }
  });
}

const dbAsync = {
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

module.exports = { db, dbAsync };
