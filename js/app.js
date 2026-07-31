// Customer Marketplace App State
let currentUser = {
  telegram_id: '',  // Will be set from Telegram WebApp or a session ID
  username: '',
  full_name: '',
  role: 'USER'
};
let currentCategory = 'All';
let filterStoreId = null;
let searchQuery = '';
let cart = [];
let selectedSize = '';
let currentProductId = null;
let activeProduct = null;
let activeTab = 'marketplace';
let isSubscribedToCurrentStore = false;

const tg = window.Telegram ? window.Telegram.WebApp : null;

// Universal Fetch Wrapper with Production API prefix and Auto-Retry
async function apiFetch(url, options = {}, retries = 3) {
  let targetUrl = url;
  if (!url.startsWith('http')) {
    const baseUrl = (window.API_BASE_URL || localStorage.getItem('BG_BACKEND_URL') || 'https://beautygo-backend-p5q9.onrender.com').replace(/\/+$/, '');
    targetUrl = baseUrl ? `${baseUrl}${url}` : url;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(targetUrl, options);
      return res;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}








document.addEventListener('DOMContentLoaded', async () => {
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
    tg.ready();
    tg.expand();
    const u = tg.initDataUnsafe.user;
    currentUser.telegram_id = String(u.id);
    currentUser.username = u.username || '';
    currentUser.full_name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  } else {
    // Outside Telegram: assign a unique per-tab session ID (sessionStorage)
    let sessionId = sessionStorage.getItem('bg_session_id');
    if (!sessionId) {
      sessionId = 'guest_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      sessionStorage.setItem('bg_session_id', sessionId);
    }
    currentUser.telegram_id = sessionId;
    currentUser.full_name = 'Mehmon';
  }

  const urlParams = new URLSearchParams(window.location.search);
  const storeParam = urlParams.get('store');
  const productParam = urlParams.get('product');

  await initUser();

  if (storeParam) {
    filterStoreId = storeParam;
    await loadStoreBanner(storeParam);
  }

  if (productParam) {
    loadProducts().then(() => openProductDetail(productParam));
  } else {
    loadProducts();
  }

  setLanguage('uz');
});

async function initUser() {
  try {
    // Save the original telegram_id that was set from Telegram/session
    const originalTelegramId = currentUser.telegram_id;
    const res = await apiFetch('/api/init-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUser)
    });
    const data = await res.json();
    if (data.success && data.user) {
      // Keep the original telegram_id - never overwrite with DB version
      const role = data.user.role || 'USER';
      currentUser = {
        ...data.user,
        telegram_id: originalTelegramId, // Always keep the session/Telegram ID
        role
      };
    }
  } catch (err) {
    console.error('Init user error:', err);
  }
}

function toggleLang() {
  const newLang = currentLang === 'uz' ? 'ru' : 'uz';
  document.getElementById('langBtn').textContent = newLang.toUpperCase();
  setLanguage(newLang);
  if (activeTab === 'marketplace') loadProducts();
}

function setBtnLoading(btn, isLoading, text = 'Bajarilmoqda...') {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${text}`;
    btn.style.opacity = '0.7';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origText || text;
    btn.style.opacity = '1';
  }
}

function showTab(tab) {
  activeTab = tab;
  document.getElementById('marketplaceView').style.display = tab === 'marketplace' ? 'block' : 'none';
  document.getElementById('ordersView').style.display = tab === 'orders' ? 'block' : 'none';

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  if (tab === 'marketplace') {
    document.getElementById('navKatalog').classList.add('active');
    loadProducts();
  } else if (tab === 'orders') {
    document.getElementById('navOrders').classList.add('active');
    loadUserOrders();
  }
}

// Load Store Profile Banner (Deep link to Store)
async function loadStoreBanner(storeId) {
  try {
    filterStoreId = storeId;
    const res = await apiFetch(`/api/stores/${storeId}`);
    const data = await res.json();
    if (data.success) {
      const s = data.store;
      document.getElementById('bannerStoreName').textContent = s.store_name;
      document.getElementById('bannerStoreDesc').textContent = s.description || '';
      document.getElementById('bannerStoreLogo').src = s.logo_url || 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=200&q=80';
      document.getElementById('bannerSubCount').textContent = `🔔 ${data.subscribers_count || 0} obunachilar`;
      document.getElementById('storeBanner').style.display = 'block';

      const subRes = await apiFetch(`/api/stores/${storeId}/subscription-status?telegram_id=${currentUser.telegram_id}`);
      const subData = await subRes.json();
      isSubscribedToCurrentStore = subData.subscribed;
      updateSubButtonUI();
      loadProducts();
    }
  } catch (err) {
    console.error('Store banner error:', err);
  }
}

function clearStoreFilter() {
  filterStoreId = null;
  document.getElementById('storeBanner').style.display = 'none';
  window.history.pushState({}, document.title, window.location.pathname);
  loadProducts();
}

async function toggleSubscription() {
  if (!filterStoreId) return;
  try {
    const res = await apiFetch(`/api/stores/${filterStoreId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: currentUser.telegram_id })
    });
    const data = await res.json();
    if (data.success) {
      isSubscribedToCurrentStore = data.subscribed;
      updateSubButtonUI();
      alert(data.message);
      loadStoreBanner(filterStoreId);
    }
  } catch (err) {
    console.error('Toggle subscription error:', err);
  }
}

function updateSubButtonUI() {
  const btn = document.getElementById('subBtn');
  if (isSubscribedToCurrentStore) {
    btn.textContent = "🔕 Obunadan chiqish";
    btn.style.background = 'rgba(255,255,255,0.15)';
  } else {
    btn.textContent = "🔔 Obuna bo'lish";
    btn.style.background = 'linear-gradient(135deg, var(--primary-pink), var(--deep-magenta))';
  }
}

function shareStoreLink() {
  if (!filterStoreId) return;
  const botUsername = 'beautyGoappbot';
  const link = `https://t.me/${botUsername}?start=store_${filterStoreId}`;
  const text = encodeURIComponent(`🌸 ${document.getElementById('bannerStoreName').textContent} do'konini Telegram Mini App-da ko'ring!`);
  
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
  } else {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`, '_blank');
  }
}

function shareProductLink(productId, title) {
  const botUsername = 'beautyGoappbot';
  const link = `https://t.me/${botUsername}?start=product_${productId}`;
  const text = encodeURIComponent(`🌸 ${title} - BeautyGo Telegram Mini App-da xarid qiling!`);

  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
  } else {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`, '_blank');
  }
}

// Load Products Catalog
async function loadProducts() {
  try {
    let url = `/api/products?category=${encodeURIComponent(currentCategory)}`;
    if (filterStoreId) url += `&store_id=${filterStoreId}`;
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

    const res = await apiFetch(url);
    const data = await res.json();

    const grid = document.getElementById('productsGrid');
    if (!data.products || data.products.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">Mahsulotlar topilmadi</div>`;
      return;
    }

    grid.innerHTML = data.products.map(p => {
      const title = currentLang === 'ru' ? p.title_ru : p.title_uz;
      const img = p.image_url || 'https://via.placeholder.com/450x450.png?text=BeautyGo';
      return `
        <div class="product-card" onclick="openProductDetail(${p.id})">
          <div class="product-img-wrapper">
            <span class="product-store-badge" onclick="event.stopPropagation(); loadStoreBanner(${p.store_id})">
              <i class="fa-solid fa-store"></i> ${escapeHtml(p.store_name)}
            </span>
            <img src="${img}" class="product-img" alt="${escapeHtml(title)}" loading="lazy">
          </div>
          <div class="product-info">
            <span class="product-category">${escapeHtml(p.category)}</span>
            <h4 class="product-title">${escapeHtml(title)}</h4>
            <div class="product-bottom">
              <span class="product-price">${p.price.toLocaleString()} so'm</span>
              <button class="add-btn" onclick="event.stopPropagation(); quickAddToCart(${p.id})">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Products load error:', err);
  }
}

function selectCategory(cat, el) {
  currentCategory = cat;
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  loadProducts();
}

let searchTimeout;
function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = document.getElementById('searchInput').value.trim();
    loadProducts();
  }, 300);
}

// Product Details Modal with Multi-Photo Gallery Slider
async function openProductDetail(id) {
  currentProductId = id;
  selectedSize = '';
  try {
    const res = await apiFetch(`/api/products/${id}`);
    const data = await res.json();
    if (!data.success) return;

    const p = data.product;
    activeProduct = p;
    const title = currentLang === 'ru' ? p.title_ru : p.title_uz;
    const desc = currentLang === 'ru' ? p.description_ru : p.description_uz;
    const sizes = p.sizes || [];
    const images = p.images && p.images.length > 0 ? p.images : [p.image_url];

    let galleryHtml = `
      <div style="width:100%; aspect-ratio:1/1; border-radius:16px; overflow:hidden; margin-bottom:12px; background:#000;">
        <img id="mainProductPhoto" src="${images[0]}" style="width:100%; height:100%; object-fit:cover; transition:opacity 0.2s;">
      </div>
    `;

    if (images.length > 1) {
      galleryHtml += `
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:8px; margin-bottom:12px;">
          ${images.map((img, idx) => `
            <img src="${img}" class="gallery-thumb ${idx === 0 ? 'active' : ''}" 
                 style="width:50px; height:50px; object-fit:cover; border-radius:8px; border:2px solid ${idx === 0 ? 'var(--primary-pink)' : 'transparent'}; cursor:pointer;"
                 onclick="setMainProductPhoto('${img}', this)">
          `).join('')}
        </div>
      `;
    }

    let sizesHtml = '';
    if (sizes.length > 0) {
      selectedSize = sizes[0];
      sizesHtml = `
        <div style="margin:16px 0;">
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">${i18n[currentLang].sizes_title}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${sizes.map((s, idx) => `
              <span class="cat-chip ${idx === 0 ? 'active' : ''}" onclick="selectProductSize('${escapeHtml(s)}', this)">${escapeHtml(s)}</span>
            `).join('')}
          </div>
        </div>
      `;
    }

    let reviewsHtml = (data.reviews || []).map(r => `
      <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:10px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; color:var(--primary-pink);">
          <span>${escapeHtml(r.user_name)}</span>
          <span>${'⭐'.repeat(r.rating)}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${escapeHtml(r.comment)}</div>
      </div>
    `).join('');

    const body = document.getElementById('productDetailBody');
    body.innerHTML = `
      ${galleryHtml}
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:11px; color:var(--primary-pink); font-weight:700; text-transform:uppercase; cursor:pointer;" onclick="closeModal('productDetailModal'); loadStoreBanner(${p.store_id});">
          <i class="fa-solid fa-store"></i> ${escapeHtml(p.store_name)} (${escapeHtml(p.category)})
        </div>
        <button class="role-btn" style="padding:4px 10px; font-size:11px;" onclick="shareProductLink(${p.id}, '${escapeHtml(title)}')">🔗 Ulashish</button>
      </div>
      <h2 style="font-family:var(--font-title); font-size:20px; margin:4px 0 8px;">${escapeHtml(title)}</h2>
      <div style="font-size:18px; font-weight:800; color:var(--accent-gold); margin-bottom:12px;">${p.price.toLocaleString()} so'm</div>
      <p style="font-size:13px; color:var(--text-muted); line-height:1.5;">${escapeHtml(desc)}</p>
      
      ${sizesHtml}

      <button class="btn-primary" style="margin-top:16px;" onclick="addCurrentProductToCart()">
        <i class="fa-solid fa-cart-plus"></i> ${i18n[currentLang].add_to_cart}
      </button>

      <div style="margin-top:24px; border-top:1px solid var(--glass-border); padding-top:16px;">
        <h4 style="font-size:14px; margin-bottom:12px;">${i18n[currentLang].reviews_title} (${data.reviews.length})</h4>
        <div>${reviewsHtml || '<div style="font-size:12px; color:var(--text-dim);">Hali sharhlar mavjud emas</div>'}</div>

        <div style="margin-top:16px;">
          <div style="margin-bottom:10px;">
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Bahoyingiz:</div>
            <div id="starRatingRow" style="display:flex; gap:6px; font-size:28px; cursor:pointer; user-select:none;">
              <span class="star-btn" data-val="1" style="opacity:0.35; transition:all 0.15s;">⭐</span>
              <span class="star-btn" data-val="2" style="opacity:0.35; transition:all 0.15s;">⭐</span>
              <span class="star-btn" data-val="3" style="opacity:0.35; transition:all 0.15s;">⭐</span>
              <span class="star-btn" data-val="4" style="opacity:0.35; transition:all 0.15s;">⭐</span>
              <span class="star-btn" data-val="5" style="opacity:0.35; transition:all 0.15s;">⭐</span>
            </div>
          </div>
          <input type="text" class="form-input" id="reviewComment" placeholder="${i18n[currentLang].write_comment}">
          <button class="role-btn" style="margin-top:8px; width:100%; padding:8px; background:var(--primary-pink);" onclick="submitReview(${p.id})">${i18n[currentLang].submit_review}</button>
        </div>
      </div>
    `;

    // Attach star rating interactivity
    let selectedRating = 5;
    const stars = body.querySelectorAll('.star-btn');
    function updateStars(val) {
      stars.forEach(s => {
        s.style.opacity = +s.dataset.val <= val ? '1' : '0.3';
        s.style.transform = +s.dataset.val <= val ? 'scale(1.15)' : 'scale(1)';
      });
    }
    updateStars(5); // default 5 stars
    stars.forEach(s => {
      s.addEventListener('mouseover', () => updateStars(+s.dataset.val));
      s.addEventListener('mouseleave', () => updateStars(selectedRating));
      s.addEventListener('click', () => {
        selectedRating = +s.dataset.val;
        updateStars(selectedRating);
        // Store on window so submitReview can access it
        window._currentStarRating = selectedRating;
      });
    });
    window._currentStarRating = 5;


    openModal('productDetailModal');
  } catch (err) {
    console.error('Product detail error:', err);
  }
}

function addCurrentProductToCart() {
  if (!activeProduct) return;
  const title = currentLang === 'ru' ? activeProduct.title_ru : activeProduct.title_uz;
  const images = activeProduct.images && activeProduct.images.length > 0 ? activeProduct.images : [activeProduct.image_url];
  const coverImg = images[0] || activeProduct.image_url || 'images/logo.jpg';

  addToCartDetailed(activeProduct.id, title, activeProduct.price, activeProduct.store_id, coverImg);
  alert("🛒 Mahsulot savatchaga qo'shildi!");
}


function setMainProductPhoto(src, el) {
  const mainImg = document.getElementById('mainProductPhoto');
  mainImg.style.opacity = 0.4;
  setTimeout(() => {
    mainImg.src = src;
    mainImg.style.opacity = 1;
  }, 100);

  document.querySelectorAll('.gallery-thumb').forEach(t => t.style.borderColor = 'transparent');
  el.style.borderColor = 'var(--primary-pink)';
}

function selectProductSize(size, el) {
  selectedSize = size;
  el.parentElement.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

async function submitReview(productId) {
  const comment = document.getElementById('reviewComment').value.trim();
  if (!comment) return;
  const rating = window._currentStarRating || 5;

  await apiFetch(`/api/products/${productId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_telegram_id: currentUser.telegram_id,
      user_name: currentUser.full_name || currentUser.username || 'Foydalanuvchi',
      rating,
      comment
    })
  });
  window._currentStarRating = 5;
  openProductDetail(productId);
}


// Cart Logic
async function quickAddToCart(productId) {
  const res = await apiFetch(`/api/products/${productId}`);
  const data = await res.json();
  if (data.success) {
    const p = data.product;
    const title = currentLang === 'ru' ? p.title_ru : p.title_uz;
    const coverImg = (p.images && p.images.length > 0) ? p.images[0] : (p.image_url || 'images/logo.jpg');
    addToCartDetailed(p.id, title, p.price, p.store_id, coverImg);
    alert("🛒 Mahsulot savatchaga qo'shildi!");
  }
}


function addToCartDetailed(id, title, price, store_id, image_url) {
  const existing = cart.find(i => i.id === id && i.size === selectedSize);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id,
      title_uz: title,
      price,
      store_id,
      image_url,
      size: selectedSize,
      quantity: 1
    });
  }

  updateCartBadge();
  closeModal('productDetailModal');
  
  if (tg && tg.HapticFeedback) {
    tg.HapticFeedback.notificationOccurred('success');
  }
}

function updateCartBadge() {
  const badge = document.getElementById('cartCountBadge');
  const count = cart.reduce((sum, i) => sum + i.quantity, 0);
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

function openCartModal() {
  renderCartItems();
  openModal('cartModal');
}

function renderCartItems() {
  const list = document.getElementById('cartItemsList');
  const checkoutSection = document.getElementById('checkoutFormSection');

  if (cart.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">${i18n[currentLang].empty_cart}</div>`;
    checkoutSection.style.display = 'none';
    return;
  }

  let total = 0;
  list.innerHTML = cart.map((item, idx) => {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    return `
      <div style="display:flex; gap:12px; align-items:center; background:rgba(255,255,255,0.04); padding:10px; border-radius:14px; margin-bottom:10px;">
        <img src="${item.image_url}" style="width:50px; height:50px; object-fit:cover; border-radius:10px;">
        <div style="flex-grow:1;">
          <div style="font-size:13px; font-weight:600;">${escapeHtml(item.title_uz)}</div>
          ${item.size ? `<div style="font-size:10px; color:var(--primary-pink);">${escapeHtml(item.size)}</div>` : ''}
          <div style="font-size:12px; color:var(--accent-gold); font-weight:700;">${item.price.toLocaleString()} so'm</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="role-btn" onclick="changeCartQty(${idx}, -1)">-</button>
          <span style="font-size:13px; font-weight:700;">${item.quantity}</span>
          <button class="role-btn" onclick="changeCartQty(${idx}, 1)">+</button>
        </div>
      </div>
    `;
  }).join('') + `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; font-size:16px; font-weight:800;">
      <span>${i18n[currentLang].total}:</span>
      <span style="color:var(--primary-pink);">${total.toLocaleString()} so'm</span>
    </div>
  `;

  checkoutSection.style.display = 'block';
  
  const savedName = localStorage.getItem('bg_user_name') || currentUser.full_name || '';
  const savedPhone = localStorage.getItem('bg_user_phone') || '';

  const nameInput = document.getElementById('checkoutName');
  const phoneInput = document.getElementById('checkoutPhone');
  const noteInput = document.getElementById('checkoutNote');

  if (nameInput) {
    nameInput.value = savedName;
    nameInput.addEventListener('focus', function() { this.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  }
  if (phoneInput) {
    phoneInput.value = savedPhone;
    phoneInput.addEventListener('focus', function() { this.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  }
  if (noteInput) {
    noteInput.addEventListener('focus', function() { this.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  }
}

function changeCartQty(idx, change) {
  cart[idx].quantity += change;
  if (cart[idx].quantity <= 0) {
    cart.splice(idx, 1);
  }
  updateCartBadge();
  renderCartItems();
}

async function submitCheckout() {
  const submitBtn = document.querySelector('#checkoutFormSection button');
  setBtnLoading(submitBtn, true, 'Buyurtma berilmoqda...');

  const name = document.getElementById('checkoutName').value.trim();
  const phone = document.getElementById('checkoutPhone').value.trim();
  const note = document.getElementById('checkoutNote') ? document.getElementById('checkoutNote').value.trim() : '';

  if (!name || !phone) {
    setBtnLoading(submitBtn, false);
    alert("Iltimos, ismingiz va telefon raqamingizni kiriting!");
    return;
  }

  // Save for next checkouts
  try {
    localStorage.setItem('bg_user_name', name);
    localStorage.setItem('bg_user_phone', phone);
  } catch(e) {}

  try {
    const res = await apiFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_telegram_id: currentUser.telegram_id,
        customer_name: name,
        customer_phone: phone,
        customer_note: note,
        items: cart
      })
    });
    const data = await res.json();
    setBtnLoading(submitBtn, false);

    if (data.success) {
      alert("🎉 Buyurtmangiz qabul qilindi! Do'kon adminiga izohingiz va buyurtmangiz Telegram orqali yuborildi.");
      cart = [];
      updateCartBadge();
      closeModal('cartModal');
      window.location.href = 'orders.html';
    }


  } catch (err) {
    setBtnLoading(submitBtn, false);
    console.error('Checkout error:', err);
  }
}

// Load User Orders History — only shows orders for the current user
async function loadUserOrders() {
  try {
    if (!currentUser.telegram_id) {
      document.getElementById('userOrdersList').innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">Buyurtmalarni ko'rish uchun Telegram orqali kiring</div>`;
      return;
    }

    const res = await apiFetch(`/api/orders/user/${encodeURIComponent(currentUser.telegram_id)}`);
    const data = await res.json();
    const list = document.getElementById('userOrdersList');

    if (!data.orders || data.orders.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">Sizda hali buyurtmalar mavjud emas</div>`;
      return;
    }

    list.innerHTML = data.orders.map(o => {
      let items = [];
      try { items = JSON.parse(o.items_json || '[]'); } catch(e){}

      return `
        <div class="admin-card" style="border-left: 4px solid ${o.status === 'APPROVED' ? '#2ECC71' : (o.status === 'CANCELLED' ? '#E74C3C' : 'var(--accent-gold)')}; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:14px; color:var(--text-light);">Buyurtma #${o.id}</span>
            <span class="order-badge ${o.status}">${o.status === 'APPROVED' ? '✅ TASDIQLANDI' : (o.status === 'CANCELLED' ? '❌ BEKOR QILINDI' : '⏳ KUTILMOQDA')}</span>
          </div>

          <div style="font-size:12px; color:var(--text-muted);">🏪 Do'kon: ${escapeHtml(o.store_name || 'BeautyGo')}</div>
          ${o.customer_note ? `<div style="font-size:11px; color:var(--accent-gold); margin-top:4px; font-weight:600; background:rgba(255,215,0,0.1); padding:4px 8px; border-radius:6px;">💬 Izohingiz: "${escapeHtml(o.customer_note)}"</div>` : ''}

          <!-- Order Items Breakdown — ALWAYS VISIBLE -->
          <div style="margin-top:10px; padding:10px; background:rgba(255,255,255,0.03); border-radius:10px;">
            <div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">📋 Mahsulotlar Ro'yxati (${items.length} ta):</div>
            ${items.length > 0 ? items.map(item => `
              <div style="display:flex; gap:10px; align-items:center; background:rgba(255,255,255,0.04); padding:6px 10px; border-radius:8px; margin-bottom:4px;">
                <img src="${item.image_url || 'images/logo.jpg'}" style="width:38px; height:38px; object-fit:cover; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
                <div style="flex-grow:1;">
                  <div style="font-size:12px; font-weight:600; color:var(--text-light);">${escapeHtml(item.title_uz || item.title_ru || 'Mahsulot')}</div>
                  ${item.size ? `<div style="font-size:10px; color:var(--primary-pink);">📏 ${escapeHtml(item.size)}</div>` : ''}
                  <div style="font-size:11px; color:var(--accent-gold);">${item.quantity || 1} dona × ${(item.price || 0).toLocaleString()} so'm</div>
                </div>
                <div style="font-size:12px; font-weight:700; color:var(--primary-pink);">${((item.quantity || 1) * (item.price || 0)).toLocaleString()} so'm</div>
              </div>
            `).join('') : '<div style="font-size:11px; color:var(--text-muted); text-align:center;">Mahsulot ma\'lumoti yo\'q</div>'}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
            <span style="font-size:14px; font-weight:800; color:var(--primary-pink);">💰 Jami: ${(o.total_price || 0).toLocaleString()} so'm</span>
            <span style="font-size:10px; color:var(--text-muted);">📦 ${new Date(o.created_at || Date.now()).toLocaleDateString('uz-UZ', {day:'2-digit', month:'2-digit', year:'numeric'})}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Load user orders error:', err);
  }
}

function toggleCustomerOrderExpand(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
  }
}
window.toggleCustomerOrderExpand = toggleCustomerOrderExpand;

// Modal Helpers

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}
window.openModal = openModal;
window.closeModal = closeModal;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
