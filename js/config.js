// =========================================================
// BeautyGo Frontend - Backend API Configuration
// =========================================================

// Global API Base URL (Production Render.com Backend 24/7)
window.API_BASE_URL = window.API_BASE_URL || localStorage.getItem('BG_BACKEND_URL') || 'https://beautygo-backend-p5q9.onrender.com';










/**
 * Universal Fetch Wrapper
 * Automatically prefixes API_BASE_URL and attaches required bypass headers
 */
function apiFetch(endpoint, options = {}) {
  let url = endpoint;
  if (!endpoint.startsWith('http')) {
    const baseUrl = (window.API_BASE_URL || '').replace(/\/+$/, '');
    url = baseUrl ? `${baseUrl}${endpoint}` : endpoint;
  }

  options.headers = Object.assign({
    'Bypass-Tunnel-Reminder': 'true'
  }, options.headers || {});

  return fetch(url, options);
}

/**
 * Helper to update Backend URL dynamically without redeploying
 */
function setBackendUrl(url) {
  if (url) {
    url = url.trim().replace(/\/+$/, '');
    localStorage.setItem('BG_BACKEND_URL', url);
    window.API_BASE_URL = url;
    console.log('✅ Backend API URL updated:', url);
  }
}
