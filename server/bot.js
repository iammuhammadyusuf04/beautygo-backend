const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { dbAsync } = require('./database');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
let bot = null;

if (BOT_TOKEN) {
  try {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.on('polling_error', (err) => {
      console.log('⚠️ Telegram bot polling warning:', err.message);
    });
    bot.on('error', (err) => {
      console.log('⚠️ Telegram bot warning:', err.message);
    });
    console.log('✨ Telegram Bot muvaffaqiyatli ishga tushirildi!');
  } catch (err) {
    console.error('⚠️ Telegram Bot ulanishda xato:', err.message);
  }
} else {

  console.log('ℹ️ BOT_TOKEN o`rnatilmagan. Bot rejimisiz faqat WebApp API ishlaydi.');
}

function escapeMarkdown(str) {
  if (!str) return '';
  return String(str).replace(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1');
}

function getValidWebAppUrl(pathSuffix = '') {
  let url = process.env.NETLIFY_URL || 'https://beautygo-frontend.onrender.com';
  url = url.trim().replace(/\/+$/, '');
  return pathSuffix ? `${url}${pathSuffix}` : url;
}




async function getRoleKeyboard(telegramId) {
  const user = await dbAsync.get('SELECT * FROM users WHERE telegram_id = ?', [String(telegramId)]);
  const ownedStore = await dbAsync.get('SELECT id FROM stores WHERE owner_telegram_id = ?', [String(telegramId)]);

  const isSuperAdmin = String(telegramId) === '1812245206' || (user && user.role === 'SUPER_ADMIN');
  const isAdmin = (user && user.role === 'ADMIN' && ownedStore) || isSuperAdmin;

  // Customer gets main marketplace URL
  let keyboard = [
    [{ text: "🌸 BeautyGo Marketpleys", web_app: { url: getValidWebAppUrl('/') } }]
  ];

  // Store Owners get dedicated /admin URL ONLY if they own a store or are SuperAdmin
  if (isAdmin) {
    keyboard.push([{ text: "🛍️ Do'kon Egasi Paneli", web_app: { url: getValidWebAppUrl('/admin') } }]);
  }

  // Super Admin gets dedicated /superadmin URL
  if (isSuperAdmin) {
    keyboard.push([{ text: "👑 Super Admin Portali", web_app: { url: getValidWebAppUrl('/superadmin') } }]);
  }

  return {
    reply_markup: {
      keyboard: keyboard,
      resize_keyboard: true
    }
  };
}


if (bot) {
  // Command: /seturl <https://your-tunnel.loca.lt> OR direct URL paste
  bot.on('message', async (msg) => {
    const text = msg.text ? msg.text.trim() : '';
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    // Auto-detect pasted URL
    if (text.startsWith('https://') && text.includes('.loca.lt') || text.includes('.ngrok') || text.includes('.pinggy') || text.includes('.trycloudflare.com')) {
      if (telegramId === '1812245206' || msg.from.username?.toLowerCase() === 'muhammadyusuf') {
        const newUrl = text.split(' ')[0].trim();
        process.env.WEBAPP_URL = newUrl;

        try {
          const envPath = path.join(__dirname, '..', '.env');
          let envContent = `PORT=3000\nBOT_TOKEN=${BOT_TOKEN}\nWEBAPP_URL=${newUrl}\n`;
          fs.writeFileSync(envPath, envContent, 'utf8');
        } catch (e) {}

        const opts = await getRoleKeyboard(telegramId);
        return bot.sendMessage(chatId, `⚡ *Yangi domen avtomatik ulandi va bot tugmalari yangilandi!*\n\n🔗 *Faol URL*: \`${newUrl}\`\n\nPastdagi tugmani bosing 👇`, { parse_mode: 'Markdown', ...opts });
      }
    }
  });

  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const telegramId = String(msg.from.id);
      const username = msg.from.username || '';
      const fullName = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();

      const param = match && match[1] ? match[1].trim() : '';

      let user = await dbAsync.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      
      let role = 'USER';
      if (telegramId === '1812245206' || username.toLowerCase() === 'muhammadyusuf' || telegramId === '7777777') {
        role = 'SUPER_ADMIN';
      }

      if (!user) {
        await dbAsync.run(
          'INSERT INTO users (telegram_id, username, full_name, role) VALUES (?, ?, ?, ?)',
          [telegramId, username, fullName, role]
        );
        user = { role };
      } else if (role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
        await dbAsync.run('UPDATE users SET role = ? WHERE telegram_id = ?', ['SUPER_ADMIN', telegramId]);
        user.role = 'SUPER_ADMIN';
      }

      // Deep linking to specific store
      if (param.startsWith('store_')) {
        const storeId = param.replace('store_', '').replace('STORE_', '');
        const store = await dbAsync.get('SELECT * FROM stores WHERE id = ?', [storeId]);
        
        const storeName = store ? store.store_name : 'Beauty Boutique';
        const welcomeText = `🌸🌸 *${storeName} sahifasiga xush kelibsiz!*\n\n` +
          `Pastdagi tugmani bosib do'kon tovarlarini ko'rishingiz va xarid qilishingiz mumkin:`;

        const inlineKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: `🛍️ 🌸 ${storeName} Marketpleysini Ochish`,
                  web_app: { url: getValidWebAppUrl(`/?store=${storeId}`) }
                }
              ]
            ]
          }
        };

        return bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown', ...inlineKeyboard });
      }

      // Deep linking to specific product
      if (param.startsWith('product_')) {
        const productId = param.replace('product_', '');
        const product = await dbAsync.get('SELECT p.*, s.store_name FROM products p JOIN stores s ON p.store_id = s.id WHERE p.id = ?', [productId]);

        if (product) {
          const welcomeText = `🌸🌸 *${product.title_uz}*\n` +
            `🏢 *Do'kon*: ${product.store_name}\n` +
            `💰 *Narxi*: ${product.price.toLocaleString()} so'm\n\n` +
            `Pastdagi tugmani bosib tovarni ko'rishingiz va xarid qilishingiz mumkin:`;

          const inlineKeyboard = {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: `✨ 🌸 Tovarni Mini App-da Ochish`,
                    web_app: { url: getValidWebAppUrl(`/?product=${productId}`) }
                  }
                ]
              ]
            }
          };

          return bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown', ...inlineKeyboard });
        }
      }

      const opts = await getRoleKeyboard(telegramId);
      const roleDisplayName = user.role === 'USER' ? 'MIJOZ (Xaridor)' : (user.role === 'ADMIN' ? "DO'KON EGASI" : 'SUPER ADMIN');
      let welcomeMsg = `🌸 *Assalomu alaykum, ${escapeMarkdown(fullName)}!*\n\n` +
        `"BeautyGo" Mini Marketplace Telegram WebApp-ga xush kelibsiz!\n\n` +
        `📌 *Sizning rolingiz*: \`${roleDisplayName}\`\n\n` +
        `Quyidagi tugmalardan birini bosib, WebApp interfeysini ochishingiz mumkin 👇`;

      await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown', ...opts });
      console.log(`✅ Telegram /start javobi yuborildi: ${chatId} (Role: ${user.role})`);
    } catch (err) {
      console.error('❌ /start javob yuborishda xato:', err.message);
    }
  });


  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('order_approve_') || data.startsWith('order_cancel_')) {
      const isApprove = data.startsWith('order_approve_');
      const orderId = data.replace(isApprove ? 'order_approve_' : 'order_cancel_', '');

      const newStatus = isApprove ? 'APPROVED' : 'CANCELLED';
      await dbAsync.run('UPDATE orders SET status = ? WHERE id = ?', [newStatus, orderId]);

      const order = await dbAsync.get('SELECT * FROM orders WHERE id = ?', [orderId]);
      const store = order ? await dbAsync.get('SELECT store_name FROM stores WHERE id = ?', [order.store_id]) : null;
      const storeName = store ? store.store_name : 'BeautyGo';

      const statusBadge = isApprove 
        ? '✅ *TASDIQLANDI* (Sotuvchi buyurtmani qabul qildi)' 
        : '❌ *BEKOR QILINDI*';

      // Retain full original order text and append status
      const origText = query.message.text || '';
      const cleanOrigText = origText.replace(/Iltimos, buyurtmani tasdiqlang yoki bekor qiling 👇.*/s, '').trim();
      const updatedText = `${cleanOrigText}\n\n📌 *Buyurtma Holati*: ${statusBadge}`;

      bot.answerCallbackQuery(query.id, { 
        text: isApprove ? `🎉 Buyurtma #${orderId} tasdiqlandi!` : `❌ Buyurtma #${orderId} bekor qilindi!` 
      });

      try {
        await bot.editMessageText(updatedText, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
      } catch (e) {
        console.error('editMessageText error:', e.message);
      }

      // Send Telegram Notification directly to CUSTOMER (Mijoz)
      if (order && order.customer_telegram_id) {
        try {
          if (isApprove) {
            const custMsg = `🎉 *Sizning Buyurtmangiz #${order.id} Tasdiqlandi!*\n\n` +
              `🏪 *Do'kon*: ${storeName}\n` +
              `💰 *Jami*: ${order.total_price.toLocaleString()} so'm\n\n` +
              `📞 Sotuvchi tez orada siz bilan bog'lanadi va buyurtmangizni etkazib beradi! Xaridingiz uchun rahmat! 🌸`;
            await bot.sendMessage(order.customer_telegram_id, custMsg, { parse_mode: 'Markdown' });
          } else {
            const custMsg = `❌ *Sizning Buyurtmangiz #${order.id} Bekor Qilindi.*\n\n` +
              `🏪 *Do'kon*: ${storeName}\n` +
              `💬 Qo'shimcha ma'lumot uchun sotuvchi bilan bog'lanishingiz mumkin.`;
            await bot.sendMessage(order.customer_telegram_id, custMsg, { parse_mode: 'Markdown' });
          }
        } catch (err) {
          console.error('Customer notification error:', err.message);
        }
      }
    }
  });
}

// Send Order Notification to Admin with Customer Telegram Link & Note
async function sendOrderNotificationToAdmin(order, store) {
  if (!bot || !store.owner_telegram_id) return;

  try {
    const items = JSON.parse(order.items_json);
    let itemsText = items.map(item => `- ${item.title_uz} ${item.size ? '('+item.size+')' : ''} x${item.quantity} (${item.price.toLocaleString()} so'm)`).join('\n');

    // Link customer's name directly to their Telegram profile
    let customerMention = order.customer_name;
    if (order.customer_telegram_id) {
      customerMention = `[${escapeMarkdown(order.customer_name)}](tg://user?id=${order.customer_telegram_id})`;
    }

    let message = `🛍️ *Yangi Buyurtma #${order.id}!*\n\n` +
      `👤 *Mijoz*: ${customerMention}\n` +
      `📞 *Tel*: ${order.customer_phone}\n\n`;

    if (order.customer_note) {
      message += `💬 *Sotuvchiga Izoh*: _"${escapeMarkdown(order.customer_note)}"_\n\n`;
    }

    message += `📋 *Mahsulotlar*:\n${itemsText}\n\n` +
      `💰 *Jami*: *${order.total_price.toLocaleString()} so'm*\n\n` +
      `Iltimos, buyurtmani tasdiqlang yoki bekor qiling 👇`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Tasdiqlash", callback_data: `order_approve_${order.id}` },
            { text: "❌ Bekor qilish", callback_data: `order_cancel_${order.id}` }
          ]
        ]
      }
    };

    await bot.sendMessage(store.owner_telegram_id, message, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    console.error('Order notification error:', err.message);
  }
}


// Store Subscription Broadcast: Sends Telegram notification with product link to subscribers
async function broadcastNewProductNotification(store, product) {
  if (!bot) return;

  try {
    const subscribers = await dbAsync.all('SELECT user_telegram_id FROM store_subscriptions WHERE store_id = ?', [store.id]);
    const productUrl = getValidWebAppUrl(`/?product=${product.id}`);

    const text = `🔔 *Siz obuna bo'lgan "${escapeMarkdown(store.store_name)}" yangi tovar yukladi!*\n\n` +
      `🌸 *${escapeMarkdown(product.title_uz)}*\n` +
      `💰 *Narxi*: ${product.price.toLocaleString()} so'm\n\n` +
      `Pastdagi tugma orqali yangi tovarni darhol ko'rishingiz mumkin 👇`;

    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `✨ 🌸 Tovarni Mini App-da Ochish`,
              web_app: { url: productUrl }
            }
          ]
        ]
      }
    };

    for (const sub of subscribers) {
      bot.sendMessage(sub.user_telegram_id, text, { parse_mode: 'Markdown', ...inlineKeyboard }).catch(() => {});
    }
  } catch (err) {
    console.error('Broadcast error:', err.message);
  }
}

async function sendCustomerOrderStatusNotification(order, status, storeName = 'BeautyGo') {
  if (!bot || !order || !order.customer_telegram_id) return;

  const isApprove = status === 'APPROVED';
  try {
    if (isApprove) {
      const custMsg = `🎉 *Sizning Buyurtmangiz #${order.id} Tasdiqlandi!*\n\n` +
        `🏪 *Do'kon*: ${escapeMarkdown(storeName)}\n` +
        `💰 *Jami*: ${order.total_price.toLocaleString()} so'm\n\n` +
        `📞 Sotuvchi tez orada siz bilan bog'lanadi va buyurtmangizni etkazib beradi! Xaridingiz uchun rahmat! 🌸`;
      await bot.sendMessage(order.customer_telegram_id, custMsg, { parse_mode: 'Markdown' });
    } else {
      const custMsg = `❌ *Sizning Buyurtmangiz #${order.id} Bekor Qilindi.*\n\n` +
        `🏪 *Do'kon*: ${escapeMarkdown(storeName)}\n` +
        `💬 Qo'shimcha ma'lumot uchun sotuvchi bilan bog'lanishingiz mumkin.`;
      await bot.sendMessage(order.customer_telegram_id, custMsg, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('Customer status notification error:', err.message);
  }
}

module.exports = { bot, getRoleKeyboard, sendOrderNotificationToAdmin, broadcastNewProductNotification, sendCustomerOrderStatusNotification };


