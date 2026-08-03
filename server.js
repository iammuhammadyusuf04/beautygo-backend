const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const apiRoutes = require('./server/routes/api');
const { bot } = require('./server/bot');
const { SUPER_ADMIN_ID } = require('./server/constants');

// localtunnel faqat development uchun yuklanadi
let localtunnel = null;
if (process.env.NODE_ENV !== 'production') {
  try { localtunnel = require('localtunnel'); } catch(e) {}
}

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

process.on('uncaughtException', (err) => {
  console.error('⚠️ Global Uncaught Exception (handled safely):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Global Unhandled Rejection (handled safely):', reason);
});

// CORS & Preflight Middleware

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Bypass-Tunnel-Reminder, X-Requested-With, X-Telegram-Init-Data');
  res.setHeader('Bypass-Tunnel-Reminder', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (IS_PRODUCTION ? 'https' : 'https');

  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const detectedUrl = `${proto}://${host}`.toLowerCase();
    if (process.env.WEBAPP_URL !== detectedUrl) {
      process.env.WEBAPP_URL = detectedUrl;
      console.log(`⚡ Yangi faol domen aniqlandi: ${detectedUrl}`);
    }
  }

  // No cache for HTML/JS
  if (req.url.endsWith('.html') || ['/', '/admin', '/superadmin'].includes(req.url)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  } else if (req.url.includes('/images/')) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  } else {
    res.setHeader('Cache-Control', 'no-store, no-cache');
  }

  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// Frontend papkasini aniqlash: 'frontend/' yoki 'public/'
const fs = require('fs');
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, 'frontend'))
  ? path.join(__dirname, 'frontend')
  : path.join(__dirname, 'public');
console.log(`📁 Frontend papkasi: ${FRONTEND_DIR}`);

// Routes
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'admin.html')));
app.get('/superadmin', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'superadmin.html')));
app.use(express.static(FRONTEND_DIR));
app.use('/api', apiRoutes);
app.get('*', (req, res) => {
  const indexFile = path.join(FRONTEND_DIR, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.json({ status: 'BeautyGo API is running', frontend: 'Not found' });
  }
});

// ===== LOCALTUNNEL (Faqat development/test uchun) =====
let tunnelInstance = null;

async function startTunnel() {
  if (IS_PRODUCTION || !localtunnel) return;

  try {
    if (tunnelInstance) {
      try { tunnelInstance.close(); } catch(e){}
    }

    tunnelInstance = await localtunnel({
      port: PORT,
      subdomain: 'beautygo-v2-1812245206'
    });

    const newUrl = tunnelInstance.url;
    process.env.WEBAPP_URL = newUrl;
    console.log(`===================================================`);
    console.log(`🌐 [TEST] Localtunnel URL: ${newUrl}`);
    console.log(`===================================================`);

    setTimeout(async () => {
      if (bot) {
        try {
          await bot.sendMessage(SUPER_ADMIN_ID,
            `🔄 *[Test Server] Qayta ishga tushdi*\n\n🌐 URL: \`${newUrl}\`\n\n⚠️ Boshqa foydalanuvchilar /start bossin!`,
            { parse_mode: 'Markdown' }
          );
        } catch(e) {}
      }
    }, 3000);

    tunnelInstance.on('close', () => {
      console.log('⚠️ Tunnel uzildi, qayta ulanmoqda...');
      setTimeout(startTunnel, 1000);
    });
    tunnelInstance.on('error', () => setTimeout(startTunnel, 1000));

  } catch (err) {
    console.error('⚠️ Tunnel xatosi:', err.message);
    setTimeout(startTunnel, 2000);
  }
}

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`===================================================`);
  console.log(`🌸 BeautyGo Telegram Mini App Server`);
  console.log(`🚀 Local: http://localhost:${PORT}`);
  console.log(`🔧 Rejim: ${IS_PRODUCTION ? '🟢 PRODUCTION' : '🟡 TEST (Localtunnel)'}`);
  console.log(`===================================================`);

  if (!IS_PRODUCTION) {
    await startTunnel();
  } else {
    console.log(`🌐 WebApp URL: ${process.env.WEBAPP_URL}`);
  }
});
