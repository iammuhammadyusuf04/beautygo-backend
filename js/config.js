// =========================================================
// BeautyGo Frontend - Backend API Configuration
// =========================================================

// Clear any stale local tunnel URLs saved in browser cache
if (localStorage.getItem('BG_BACKEND_URL')) {
  const oldUrl = localStorage.getItem('BG_BACKEND_URL');
  if (oldUrl.includes('trycloudflare.com') || oldUrl.includes('loca.lt') || oldUrl.includes('localhost')) {
    localStorage.removeItem('BG_BACKEND_URL');
  }
}

// Global Production API Base URL
window.API_BASE_URL = localStorage.getItem('BG_BACKEND_URL') || 'https://beautygo-backend-p5q9.onrender.com';
