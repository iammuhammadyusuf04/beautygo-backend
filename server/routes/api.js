const express = require('express');
const router = express.Router();
const { dbAsync } = require('../database');
const { sendOrderNotificationToAdmin, broadcastNewProductNotification, sendCustomerOrderStatusNotification } = require('../bot');


// Helper to guarantee at least one active store exists
async function getOrCreateActiveStore(ownerTelegramId = '1812245206') {
  let store = await dbAsync.get('SELECT * FROM stores ORDER BY id DESC LIMIT 1');
  if (!store) {
    const result = await dbAsync.run(
      `INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin, status)
       VALUES (?, 'BeautyGo Boutique', 'Ayollar parfyum va brend kiyimlari', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80', 10.0, 'ACTIVE')`,
      [String(ownerTelegramId)]
    );
    store = await dbAsync.get('SELECT * FROM stores WHERE id = ?', [result.lastID]);
  }
  return store;
}

// 1. Init User & Role Check (Supports Telegram ID & Username auto-link)
router.post('/init-user', async (req, res) => {
  try {
    const { telegram_id, username, full_name } = req.body;
    if (!telegram_id) {
      return res.status(400).json({ error: 'telegram_id majburiy!' });
    }

    const tid = String(telegram_id);
    const cleanUsername = (username || '').trim().replace(/^@/, '');

    // Search user by telegram_id OR username match
    let user = await dbAsync.get(
      'SELECT * FROM users WHERE telegram_id = $1 OR (username IS NOT NULL AND username != $2 AND LOWER(username) = LOWER($3))',
      [tid, '', cleanUsername]
    );

    // Auto-link telegram_id if user was originally created by username
    if (user && user.telegram_id !== tid) {
      const oldId = user.telegram_id;
      await dbAsync.run('UPDATE users SET telegram_id = ? WHERE telegram_id = ?', [tid, oldId]);
      await dbAsync.run('UPDATE stores SET owner_telegram_id = ? WHERE owner_telegram_id = ?', [tid, oldId]);
      user.telegram_id = tid;
    }

    // Super Admin Broadcast (Send message/ad with photo, video, links & buttons to all bot users)
    router.post('/super-admin/broadcast', async (req, res) => {
      try {
        const { admin_telegram_id, message, media_type, media_url, button_text, button_url } = req.body;
        
        const tid = String(admin_telegram_id || '');
        const user = await dbAsync.get('SELECT * FROM users WHERE telegram_id = ?', [tid]);
        const isSuperAdmin = tid === '1812245206' || (user && user.role === 'SUPER_ADMIN');

        if (!isSuperAdmin) {
          return res.status(403).json({ error: "Ruxsat etilmagan! Faqat Super Admin xabar yubora oladi." });
        }

        if (!message || !message.trim()) {
          return res.status(400).json({ error: "Xabar matni bo'sh bo'lmasligi kerak!" });
        }

        const allUsers = await dbAsync.all(
          `SELECT DISTINCT telegram_id FROM users WHERE telegram_id IS NOT NULL AND telegram_id NOT LIKE 'guest_%'`
        );

        if (!allUsers || allUsers.length === 0) {
          return res.json({ success: true, count: 0, sent: 0, failed: 0, message: "Bazada bot foydalanuvchilari topilmadi." });
        }

        const { bot } = require('../bot');
        if (!bot) {
          return res.status(500).json({ error: "Telegram Bot faol emas!" });
        }

        let replyMarkup = undefined;
        if (button_text && button_url) {
          replyMarkup = {
            inline_keyboard: [
              [{ text: button_text, url: button_url }]
            ]
          };
        }

        const options = {
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        };

        let sent = 0;
        let failed = 0;

        const effectiveMediaType = media_type || (media_url ? 'photo' : 'none');

        for (const u of allUsers) {
          try {
            if (effectiveMediaType === 'photo' && media_url) {
              await bot.sendPhoto(u.telegram_id, media_url, { caption: message, ...options });
            } else if (effectiveMediaType === 'video' && media_url) {
              await bot.sendVideo(u.telegram_id, media_url, { caption: message, ...options });
            } else {
              await bot.sendMessage(u.telegram_id, message, options);
            }
            sent++;
          } catch (err) {
            try {
              await bot.sendMessage(u.telegram_id, message, replyMarkup ? { reply_markup: replyMarkup } : undefined);
              sent++;
            } catch (retryErr) {
              failed++;
            }
          }
        }

        res.json({
          success: true,
          total_users: allUsers.length,
          sent,
          failed,
          message: `📢 Reklama e'loni ${sent} ta foydalanuvchiga muvaffaqiyatli yetkazildi (${failed} ta yetmadi).`
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });


    // Super admin check
    const isSuperAdmin = (cleanUsername && cleanUsername.toLowerCase() === 'muhammadyusuf')
      || tid === '1812245206'
      || tid === '7777777';

    // Check if this user owns any store
    let ownedStore = await dbAsync.get('SELECT * FROM stores WHERE owner_telegram_id = ?', [tid]);
    if (!ownedStore && cleanUsername) {
      ownedStore = await dbAsync.get('SELECT * FROM stores WHERE owner_telegram_id = ?', [cleanUsername]);
      if (ownedStore) {
        await dbAsync.run('UPDATE stores SET owner_telegram_id = ? WHERE id = ?', [tid, ownedStore.id]);
        ownedStore.owner_telegram_id = tid;
      }
    }
    const isStoreOwner = !!ownedStore;

    const activeStore = await getOrCreateActiveStore(tid);

    if (!user) {
      let role = 'USER';
      if (isSuperAdmin) role = 'SUPER_ADMIN';
      else if (isStoreOwner) role = 'ADMIN';

      await dbAsync.run(
        'INSERT INTO users (telegram_id, username, full_name, role) VALUES (?, ?, ?, ?)',
        [tid, cleanUsername, full_name || 'Foydalanuvchi', role]
      );
      user = await dbAsync.get('SELECT * FROM users WHERE telegram_id = ?', [tid]);
    } else {
      if (isSuperAdmin && user.role !== 'SUPER_ADMIN') {
        await dbAsync.run('UPDATE users SET role = $1 WHERE telegram_id = $2', ['SUPER_ADMIN', tid]);
        user.role = 'SUPER_ADMIN';
      } else if (isStoreOwner && user.role === 'USER') {
        await dbAsync.run('UPDATE users SET role = $1 WHERE telegram_id = $2', ['ADMIN', tid]);
        user.role = 'ADMIN';
      }
    }

    const returnStore = (user.role === 'ADMIN' && ownedStore) ? ownedStore : activeStore;

    res.json({ success: true, user, store: returnStore });
  } catch (err) {
    console.error('init-user error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// 2. Ultra-Fast Product Catalog RPC
router.get('/products', async (req, res) => {
  try {
    const { category, search, store_id } = req.query;
    let sql = `SELECT p.id, p.store_id, p.title_uz, p.title_ru, p.price, p.category, p.sizes, p.image_url, p.images_json,
               COALESCE(s.store_name, 'BeautyGo Boutique') as store_name,
               COALESCE(s.logo_url, 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80') as store_logo
               FROM products p
               LEFT JOIN stores s ON p.store_id = s.id
               WHERE (p.is_active = 1 OR p.is_active IS NULL)`;
    let params = [];

    if (category && category !== 'All') {
      params.push(category);
      sql += ` AND (p.category = $${params.length}::text OR LOWER(p.category) = LOWER($${params.length}::text))`;
    }
    if (store_id) {
      params.push(store_id);
      sql += ` AND (p.store_id = $${params.length} OR p.store_id::text = $${params.length}::text)`;
    }
    if (search) {
      params.push(`%${search}%`);
      const searchIdx = params.length;
      sql += ` AND (p.title_uz ILIKE $${searchIdx}::text OR p.title_ru ILIKE $${searchIdx}::text)`;
    }

    sql += ' ORDER BY p.id DESC';


    const products = await dbAsync.all(sql, params);

    const formatted = products.map(p => {
      // Parse images_json and use first real image as display image
      let images = [];
      if (p.images_json) {
        try { images = JSON.parse(p.images_json); } catch(e) {}
      }
      // Use first image from images_json if available, otherwise fall back to image_url
      const displayImage = (images && images.length > 0) ? images[0] : (p.image_url || 'images/logo.jpg');
      return {
        ...p,
        sizes: p.sizes ? JSON.parse(p.sizes) : [],
        image_url: displayImage,
        images
      };
    });

    res.json({ success: true, count: formatted.length, products: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 3. Single Store Info & Single Product Details
router.get('/stores/:id', async (req, res) => {
  try {
    let store = await dbAsync.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
    if (!store) {
      store = await getOrCreateActiveStore();
    }

    const productsCount = await dbAsync.get('SELECT COUNT(*) as count FROM products WHERE store_id = ? AND is_active = 1', [store.id]);
    const subscribersCount = await dbAsync.get('SELECT COUNT(*) as count FROM store_subscriptions WHERE store_id = ?', [store.id]);

    res.json({
      success: true,
      store,
      products_count: productsCount ? productsCount.count : 0,
      subscribers_count: subscribersCount ? subscribersCount.count : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const product = await dbAsync.get(
      'SELECT p.*, s.store_name, s.logo_url as store_logo FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = ?',
      [req.params.id]
    );
    if (!product) return res.status(404).json({ error: 'Mahsulot topilmadi!' });

    product.sizes = product.sizes ? JSON.parse(product.sizes) : [];
    
    let images = [];
    if (product.images_json) {
      try { images = JSON.parse(product.images_json); } catch (e) { images = []; }
    }
    if (!images || images.length === 0) {
      images = [product.image_url];
    }
    product.images = images;
    if (images && images.length > 0 && images[0]) {
      product.image_url = images[0];
    }


    const reviews = await dbAsync.all('SELECT * FROM reviews WHERE product_id = ? ORDER BY id DESC', [req.params.id]);

    res.json({ success: true, product, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Product Add / Edit / Delete
router.post('/products', async (req, res) => {
  try {
    let { store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, images, telegram_id } = req.body;

    let targetStoreId = null;

    // 1. If user telegram_id provided, check if they own a store
    if (telegram_id) {
      const owned = await dbAsync.get('SELECT id FROM stores WHERE owner_telegram_id = ? ORDER BY id DESC LIMIT 1', [String(telegram_id)]);
      if (owned) targetStoreId = owned.id;
    }

    // 2. If store_id was passed, check if it exists in stores table
    if (!targetStoreId && store_id) {
      const validStore = await dbAsync.get('SELECT id FROM stores WHERE id = ?', [store_id]);
      if (validStore) targetStoreId = validStore.id;
    }

    // 3. Fallback to active store
    if (!targetStoreId) {
      const activeStore = await getOrCreateActiveStore();
      targetStoreId = activeStore.id;
    }

    const imgList = Array.isArray(images) && images.length > 0 ? images : ['https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80'];
    const coverImage = imgList[0] || '';
    const imagesJson = JSON.stringify(imgList);

    const result = await dbAsync.run(
      `INSERT INTO products (store_id, title_uz, title_ru, description_uz, description_ru, price, category, sizes, image_url, images_json, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        targetStoreId,
        title_uz || 'Mahsulot',
        title_ru || title_uz || 'Mahsulot',
        description_uz || '',
        description_ru || description_uz || '',
        parseFloat(price) || 0,
        category || 'Kosmetika',
        JSON.stringify(sizes || []),
        coverImage,
        imagesJson
      ]
    );


    // Send response FIRST, then broadcast (non-blocking)
    res.json({ success: true, product_id: result.lastID, message: "Mahsulot qo'shildi!" });

    // Broadcast notification in background (does NOT affect response)
    try {
      const store = await dbAsync.get('SELECT * FROM stores WHERE id = ?', [store_id]);
      if (store) {
        broadcastNewProductNotification(store, { id: result.lastID, title_uz, price: parseFloat(price) || 0, image_url: coverImage });
      }
    } catch (broadcastErr) {
      console.error('Broadcast error (non-critical):', broadcastErr.message);
    }
  } catch (err) {
    console.error('POST /products error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.put('/products/:id', async (req, res) => {
  try {
    const { title_uz, title_ru, description_uz, description_ru, price, category, sizes, images } = req.body;
    const imgList = Array.isArray(images) && images.length > 0 ? images : [req.body.image_url || ''];
    const coverImage = imgList[0] || '';  // base64 or URL — store directly
    const imagesJson = JSON.stringify(imgList);
    
    await dbAsync.run(
      `UPDATE products SET title_uz=?, title_ru=?, description_uz=?, description_ru=?, price=?, category=?, sizes=?, image_url=?, images_json=? WHERE id=?`,
      [
        title_uz || 'Mahsulot',
        title_ru || title_uz || 'Mahsulot',
        description_uz || '',
        description_ru || description_uz || '',
        parseFloat(price) || 0,
        category || 'Kosmetika',
        JSON.stringify(sizes || []),
        coverImage,
        imagesJson,
        req.params.id
      ]
    );

    res.json({ success: true, message: "Mahsulot yangilandi!" });
  } catch (err) {
    console.error('PUT /products error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    await dbAsync.run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: "Mahsulot o'chirildi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Store Profile Update
router.put('/admin/store-profile', async (req, res) => {
  try {
    const { store_id, store_name, description, logo_url } = req.body;
    let finalLogo = logo_url;
    if (!finalLogo || finalLogo.trim() === '') {
      const existing = await dbAsync.get('SELECT logo_url FROM stores WHERE id = ?', [store_id]);
      finalLogo = existing ? existing.logo_url : 'images/logo.jpg';
    }
    await dbAsync.run(
      'UPDATE stores SET store_name = ?, description = ?, logo_url = ? WHERE id = ?',
      [store_name || 'Beauty Boutique', description || '', finalLogo, store_id]
    );
    res.json({ success: true, message: "Do'kon ma'lumotlari yangilandi!" });
  } catch (err) {
    console.error('Store profile update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// 6. Subscriptions Management
router.post('/stores/:id/subscribe', async (req, res) => {
  try {
    const { telegram_id } = req.body;
    const storeId = req.params.id;

    const existing = await dbAsync.get(
      'SELECT * FROM store_subscriptions WHERE user_telegram_id = ? AND store_id = ?',
      [String(telegram_id), storeId]
    );

    if (existing) {
      await dbAsync.run(
        'DELETE FROM store_subscriptions WHERE user_telegram_id = ? AND store_id = ?',
        [String(telegram_id), storeId]
      );
      res.json({ success: true, subscribed: false, message: "Obunadan chiqildi" });
    } else {
      await dbAsync.run(
        'INSERT INTO store_subscriptions (user_telegram_id, store_id) VALUES (?, ?)',
        [String(telegram_id), storeId]
      );
      res.json({ success: true, subscribed: true, message: "Do'konga muvaffaqiyatli obuna bo'ldingiz!" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stores/:id/subscription-status', async (req, res) => {
  try {
    const { telegram_id } = req.query;
    const existing = await dbAsync.get(
      'SELECT * FROM store_subscriptions WHERE user_telegram_id = ? AND store_id = ?',
      [String(telegram_id), req.params.id]
    );
    res.json({ success: true, subscribed: !!existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Checkout & Order Creation
router.post('/orders', async (req, res) => {
  try {
    const { customer_telegram_id, customer_name, customer_phone, customer_note, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Savatcha bo'sh!" });
    }

    const storeOrdersMap = {};
    items.forEach(item => {
      if (!storeOrdersMap[item.store_id]) {
        storeOrdersMap[item.store_id] = [];
      }
      storeOrdersMap[item.store_id].push(item);
    });

    const createdOrders = [];

    for (const storeId in storeOrdersMap) {
      const storeItems = storeOrdersMap[storeId];
      const store = await dbAsync.get('SELECT * FROM stores WHERE id = ?', [storeId]);
      
      let storeTotal = 0;
      storeItems.forEach(i => { storeTotal += (i.price * i.quantity); });

      const marginPct = store ? store.commission_margin : 10.0;
      const commissionAmount = (storeTotal * marginPct) / 100.0;

      const orderResult = await dbAsync.run(
        `INSERT INTO orders (customer_telegram_id, customer_name, customer_phone, customer_note, store_id, items_json, total_price, commission_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          String(customer_telegram_id),
          customer_name,
          customer_phone,
          customer_note || '',
          storeId,
          JSON.stringify(storeItems),
          storeTotal,
          commissionAmount
        ]
      );

      const orderObj = {
        id: orderResult.lastID,
        customer_telegram_id: String(customer_telegram_id),
        customer_name,
        customer_phone,
        customer_note: customer_note || '',
        store_id: storeId,
        items_json: JSON.stringify(storeItems),
        total_price: storeTotal,
        commission_amount: commissionAmount,
        status: 'PENDING'
      };


      createdOrders.push(orderObj);

      if (store) {
        sendOrderNotificationToAdmin(orderObj, store);
      }
    }

    res.json({ success: true, orders: createdOrders, message: "Buyurtma qabul qilindi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Order Queries — each user only sees their own orders
router.get('/orders/user/:telegram_id', async (req, res) => {
  try {
    const tid = String(req.params.telegram_id);
    const orders = await dbAsync.all(
      `SELECT o.id, o.customer_telegram_id, o.customer_name, o.customer_phone,
              o.customer_note, o.store_id, o.items_json, o.total_price, o.status, o.created_at,
              COALESCE(s.store_name, 'BeautyGo Boutique') as store_name
       FROM orders o
       LEFT JOIN stores s ON o.store_id = s.id
       WHERE o.customer_telegram_id = ?
       ORDER BY o.id DESC`,
      [tid]
    );
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/orders/store/:store_id', async (req, res) => {
  try {
    const orders = await dbAsync.all(
      `SELECT * FROM orders WHERE store_id = ? ORDER BY id DESC`,
      [req.params.store_id]
    );
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    await dbAsync.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);

    // Send Telegram Notification directly to Customer
    try {
      const order = await dbAsync.get('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (order) {
        const store = await dbAsync.get('SELECT store_name FROM stores WHERE id = ?', [order.store_id]);
        const storeName = store ? store.store_name : 'BeautyGo';
        sendCustomerOrderStatusNotification(order, status, storeName);
      }
    } catch (notifErr) {
      console.error('Failed sending customer order status notification:', notifErr.message);
    }

    res.json({ success: true, message: `Buyurtma holati: ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/admin/store-stats/:store_id?', async (req, res) => {
  try {
    const { telegram_id } = req.query;
    let storeId = req.params.store_id;
    let store = null;

    if (storeId && storeId !== 'null' && storeId !== 'undefined') {
      store = await dbAsync.get('SELECT * FROM stores WHERE id = ?', [storeId]);
    }

    if (!store && telegram_id) {
      store = await dbAsync.get('SELECT * FROM stores WHERE owner_telegram_id = ? ORDER BY id DESC LIMIT 1', [String(telegram_id)]);
    }

    if (!store) {
      if (String(telegram_id) === '1812245206') {
        store = await getOrCreateActiveStore();
      } else {
        return res.status(403).json({ success: false, error: "Siz do'kon egasi emassiz yoki sizning do'koningiz o'chirilgan!" });
      }
    }

    if (telegram_id && String(telegram_id) !== '1812245206' && String(store.owner_telegram_id) !== String(telegram_id)) {
      const ownStore = await dbAsync.get('SELECT * FROM stores WHERE owner_telegram_id = ? ORDER BY id DESC LIMIT 1', [String(telegram_id)]);
      if (ownStore) {
        store = ownStore;
      } else {
        return res.status(403).json({ success: false, error: "Siz do'kon egasi emassiz yoki sizning do'koningiz o'chirilgan!" });
      }
    }
    
    storeId = store.id;


    const totalSalesRow = await dbAsync.get(
      `SELECT SUM(total_price) as total_sales, COUNT(*) as total_orders FROM orders WHERE store_id = ? AND status = 'APPROVED'`,
      [storeId]
    );
    const totalProductsRow = await dbAsync.get(
      `SELECT COUNT(*) as total_products FROM products WHERE store_id = ? AND is_active = 1`,
      [storeId]
    );
    const payoutsRow = await dbAsync.get(
      `SELECT SUM(amount) as total_payouts FROM payouts WHERE store_id = ?`,
      [storeId]
    );

    const totalSales = (totalSalesRow && totalSalesRow.total_sales) ? totalSalesRow.total_sales : 0;
    const marginPct = store.commission_margin || 10.0;
    const totalCommissionDue = (totalSales * marginPct) / 100.0;
    const totalPaidOut = (payoutsRow && payoutsRow.total_payouts) ? payoutsRow.total_payouts : 0;
    const remainingBalance = totalCommissionDue - totalPaidOut;
    const netOwnerEarnings = totalSales - totalCommissionDue;

    res.json({
      success: true,
      store,
      total_sales: totalSales,
      total_orders: (totalSalesRow && totalSalesRow.total_orders) ? totalSalesRow.total_orders : 0,
      total_products: (totalProductsRow && totalProductsRow.total_products) ? totalProductsRow.total_products : 0,
      commission_margin: marginPct,
      total_commission_due: totalCommissionDue,
      total_paid_out: totalPaidOut,
      remaining_balance: remainingBalance,
      net_owner_earnings: netOwnerEarnings
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Super Admin Dashboard & Hard Store Deletion
router.get('/super-admin/dashboard', async (req, res) => {
  try {
    const storesRaw = await dbAsync.all(
      `SELECT s.*, u.full_name as owner_name FROM stores s LEFT JOIN users u ON s.owner_telegram_id = u.telegram_id`
    );

    let globalSales = 0;
    let globalCommissionDue = 0;
    let globalPaidOut = 0;

    const storesDetailed = [];

    for (const s of storesRaw) {
      const salesRow = await dbAsync.get(
        `SELECT SUM(total_price) as sales FROM orders WHERE store_id = ? AND status = 'APPROVED'`,
        [s.id]
      );
      const sales = (salesRow && salesRow.sales) ? salesRow.sales : 0;
      const commDue = (sales * s.commission_margin) / 100.0;

      const payoutsRow = await dbAsync.get(
        `SELECT SUM(amount) as paid FROM payouts WHERE store_id = ?`,
        [s.id]
      );
      const paid = (payoutsRow && payoutsRow.paid) ? payoutsRow.paid : 0;
      const remaining = commDue - paid;

      globalSales += sales;
      globalCommissionDue += commDue;
      globalPaidOut += paid;

      storesDetailed.push({
        ...s,
        total_sales: sales,
        commission_due: commDue,
        total_paid_out: paid,
        remaining_balance: remaining
      });
    }

    const payoutsHistory = await dbAsync.all(`
      SELECT p.*, s.store_name FROM payouts p JOIN stores s ON p.store_id = s.id ORDER BY p.id DESC
    `);

    const allOrders = await dbAsync.all(`
      SELECT o.*, s.store_name FROM orders o LEFT JOIN stores s ON o.store_id = s.id ORDER BY o.id DESC
    `);

    const allUsers = await dbAsync.all(`
      SELECT * FROM users WHERE telegram_id IS NOT NULL AND telegram_id NOT LIKE 'guest_%' ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      global_sales: globalSales,
      global_commission_due: globalCommissionDue,
      global_paid_out: globalPaidOut,
      global_remaining_balance: globalCommissionDue - globalPaidOut,
      stores: storesDetailed,
      payouts: payoutsHistory,
      orders: allOrders,
      users: allUsers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post('/super-admin/stores', async (req, res) => {
  try {
    let { owner_telegram_id, store_name, description, logo_url, commission_margin } = req.body;

    if (!owner_telegram_id || !store_name) {
      return res.status(400).json({ error: "owner_telegram_id (yoki Telegram Username) va store_name majburiy!" });
    }

    const cleanOwnerInput = String(owner_telegram_id).trim().replace(/^@/, '');

    let user = await dbAsync.get(
      'SELECT * FROM users WHERE telegram_id = $1 OR (username != $2 AND LOWER(username) = LOWER($3))',
      [cleanOwnerInput, '', cleanOwnerInput]
    );

    if (!user) {
      await dbAsync.run(
        'INSERT INTO users (telegram_id, username, full_name, role) VALUES (?, ?, ?, ?)',
        [cleanOwnerInput, cleanOwnerInput, store_name + ' Egasi', 'ADMIN']
      );
    } else {
      await dbAsync.run('UPDATE users SET role = ? WHERE telegram_id = ? OR username = ?', ['ADMIN', cleanOwnerInput, cleanOwnerInput]);
    }

    const result = await dbAsync.run(
      `INSERT INTO stores (owner_telegram_id, store_name, description, logo_url, commission_margin, status) 
       VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        cleanOwnerInput,
        store_name,
        description || '',
        logo_url || 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80',
        parseFloat(commission_margin || 10.0)
      ]
    );

    res.json({ success: true, store_id: result.lastID, message: "Yangi do'kon va do'kon egasi muvaffaqiyatli yaratildi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Hard Store Deletion (Super Admin) - Removes store, products, and subscriptions permanently & demotes admin role
router.delete('/super-admin/stores/:id', async (req, res) => {
  try {
    const storeId = req.params.id;
    const store = await dbAsync.get('SELECT owner_telegram_id FROM stores WHERE id = ?', [storeId]);

    await dbAsync.run('DELETE FROM stores WHERE id = ?', [storeId]);
    await dbAsync.run('DELETE FROM products WHERE store_id = ?', [storeId]);
    await dbAsync.run('DELETE FROM store_subscriptions WHERE store_id = ?', [storeId]);

    // Demote user back to USER role if they own no other stores
    if (store && store.owner_telegram_id) {
      const remaining = await dbAsync.get('SELECT COUNT(*) as cnt FROM stores WHERE owner_telegram_id = ?', [store.owner_telegram_id]);
      if (!remaining || remaining.cnt === 0) {
        await dbAsync.run('UPDATE users SET role = ? WHERE telegram_id = ? AND role != ?', ['USER', String(store.owner_telegram_id), 'SUPER_ADMIN']);
      }
    }

    res.json({ success: true, message: "Do'kon va uning admin huquqlari to'liq o'chirildi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.put('/super-admin/store-margin', async (req, res) => {
  try {
    const { store_id, commission_margin } = req.body;
    await dbAsync.run('UPDATE stores SET commission_margin = ? WHERE id = ?', [parseFloat(commission_margin), store_id]);
    res.json({ success: true, message: "Komissiya foizi yangilandi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/super-admin/payout', async (req, res) => {
  try {
    const { store_id, amount, note } = req.body;
    await dbAsync.run(
      'INSERT INTO payouts (store_id, amount, note) VALUES (?, ?, ?)',
      [store_id, parseFloat(amount), note || "Super Admin tomondan qabul qilindi"]
    );
    res.json({ success: true, message: "Mablağ qabul qilingani va balans yangilandi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products/:id/reviews', async (req, res) => {
  try {
    const { user_telegram_id, user_name, rating, comment } = req.body;
    await dbAsync.run(
      'INSERT INTO reviews (product_id, user_telegram_id, user_name, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, String(user_telegram_id), user_name || 'Xaridor', parseInt(rating), comment]
    );
    res.json({ success: true, message: "Izohingiz uchun rahmat!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
