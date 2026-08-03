// Verifies Telegram WebApp `initData` per Telegram's official validation algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MAX_AGE_SECONDS = 86400; // reject initData older than 24h (replay protection)

// Returns { id, username, first_name, last_name } on success, or null if invalid/missing.
function verifyTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const a = Buffer.from(computedHash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (!authDate || ageSeconds > MAX_AGE_SECONDS || ageSeconds < -60) return null;

    const userJson = params.get('user');
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    if (!user || !user.id) return null;

    return {
      id: String(user.id),
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || ''
    };
  } catch (e) {
    return null;
  }
}

module.exports = { verifyTelegramInitData };
