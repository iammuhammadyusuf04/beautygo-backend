// Store Owner Admin Controller - 100% Telegram WebApp Compatible
let currentUser = {
  telegram_id: '',
  username: '',
  full_name: '',
  role: 'ADMIN'
};
// No hardcoded placeholder store here on purpose: which store (if any) this
// account owns is resolved server-side in /init-user and /admin/store-stats.
// A hardcoded fallback id here used to make non-owning accounts silently query
// someone else's store and get rejected as "not yours".
let userStore = null;
let uploadedImagesList = [];

const tg = window.Telegram ? window.Telegram.WebApp : null;

// Universal Fetch Wrapper with Production API prefix and Auto-Retry
async function apiFetch(url, options = {}, retries = 3) {
  let targetUrl = url;
  if (!url.startsWith('http')) {
    const baseUrl = (window.API_BASE_URL || localStorage.getItem('BG_BACKEND_URL') || 'https://beautygo-backend-p5q9.onrender.com').replace(/\/+$/, '');
    targetUrl = baseUrl ? `${baseUrl}${url}` : url;
  }

  // Identity: verified Telegram initData (production) + telegram_id fallback (local/browser testing)
  if (currentUser && currentUser.telegram_id && !targetUrl.includes('telegram_id=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl += `${sep}telegram_id=${encodeURIComponent(currentUser.telegram_id)}`;
  }
  options.headers = {
    ...(options.headers || {}),
    ...(tg && tg.initData ? { 'X-Telegram-Init-Data': tg.initData } : {})
  };

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
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    tg.ready();
    tg.expand();
    const u = tg.initDataUnsafe.user;
    currentUser.telegram_id = String(u.id);
    currentUser.username = u.username || '';
    currentUser.full_name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  } else {
    currentUser.telegram_id = '8888888';
    currentUser.username = 'beauty_owner';
    currentUser.full_name = "Zuhra Do'kon Egasi";
  }

  await initUser();
});

async function initUser() {
  try {
    const res = await apiFetch('/api/init-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUser)
    });
    const data = await res.json();
    
    if (data.success) {
      currentUser = data.user;
      if (data.store) {
        userStore = data.store;
      }
      await loadAdminDashboard();
    }
  } catch (err) {
    console.error('Init admin user error:', err);
  }
}

function toggleLang() {
  const newLang = currentLang === 'uz' ? 'ru' : 'uz';
  document.getElementById('langBtn').textContent = newLang.toUpperCase();
  setLanguage(newLang);
}
window.toggleLang = toggleLang;

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

async function loadAdminDashboard() {
  const activeStoreId = (userStore && userStore.id) ? userStore.id : '';
  const url = activeStoreId 
    ? `/api/admin/store-stats/${activeStoreId}?telegram_id=${currentUser.telegram_id}`
    : `/api/admin/store-stats?telegram_id=${currentUser.telegram_id}`;

  try {
    const statsRes = await apiFetch(url);
    const statsData = await statsRes.json();

    if (!statsData.success || !statsData.store) {
      const container = document.querySelector('.app-container');
      if (container) {
        container.innerHTML = `
          <div style="text-align:center; padding:60px 20px;">
            <div style="font-size:64px; margin-bottom:16px;">⛔</div>
            <h2 style="font-family:var(--font-title); font-size:22px; color:#E74C3C; margin-bottom:10px;">Kirish Taqiqlangan</h2>
            <p style="font-size:14px; color:var(--text-muted); margin-bottom:24px;">Siz do'kon egasi emassiz yoki admin huquqingiz o'chirilgan!</p>
            <a href="/" class="role-btn" style="background:var(--primary-pink); padding:12px 24px; text-decoration:none; display:inline-block; font-weight:700;">🌸 Bosh Katalogga Qaytish</a>
          </div>
        `;
      }
      return;
    }

    const s = statsData.store;
    userStore = s;

      
      const realStoreId = s.id;

      const [ordersRes, prodRes] = await Promise.all([
        apiFetch(`/api/orders/store/${realStoreId}`),
        apiFetch(`/api/products?store_id=${realStoreId}`)
      ]);

      const ordersData = await ordersRes.json();
      const prodData = await prodRes.json();

      const nameEl = document.getElementById('adminStoreName');
      const logoEl = document.getElementById('adminLogoDisplay');
      if (nameEl) nameEl.textContent = s.store_name || "Ms beauty";
      if (logoEl) logoEl.src = s.logo_url || 'images/logo.jpg';

      const sSales = document.getElementById('statSales');
      const sNet = document.getElementById('statNetEarnings');
      const sComm = document.getElementById('statCommDue');
      const sPaid = document.getElementById('statPaidOut');
      const sRem = document.getElementById('statRemainingDue');

      if (sSales) sSales.textContent = `${(statsData.total_sales || 0).toLocaleString()} so'm`;
      if (sNet) sNet.textContent = `${(statsData.net_owner_earnings || 0).toLocaleString()} so'm`;
      if (sComm) sComm.textContent = `${(statsData.total_commission_due || 0).toLocaleString()} so'm`;
      if (sPaid) sPaid.textContent = `${(statsData.total_paid_out || 0).toLocaleString()} so'm`;
      if (sRem) sRem.textContent = `${(statsData.remaining_balance || 0).toLocaleString()} so'm`;

      // Render Store Orders
      const ordersList = document.getElementById('storeOrdersList');
      if (ordersList) {
        if (!ordersData.orders || ordersData.orders.length === 0) {
          ordersList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Hali buyurtmalar kelib tushmadi</div>`;
        } else {
          ordersList.innerHTML = ordersData.orders.map(o => {
            let items = [];
            try { items = JSON.parse(o.items_json || '[]'); } catch(e){}

            const tgLink = o.customer_telegram_id ? `tg://user?id=${o.customer_telegram_id}` : null;

            return `
              <div class="admin-card" style="border-left: 4px solid ${o.status === 'APPROVED' ? '#2ECC71' : (o.status === 'CANCELLED' ? '#E74C3C' : 'var(--accent-gold)')};margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span style="font-weight:700; font-size:15px; color:var(--text-light);">
                    #${o.id} | <a href="tg://user?id=${o.customer_telegram_id}" target="_blank" style="color:var(--primary-pink); text-decoration:underline;" onclick="event.stopPropagation();">${escapeHtml(o.customer_name)}</a>
                  </span>
                  <span class="order-badge ${o.status}">${o.status === 'APPROVED' ? '✅ TASDIQLANDI' : (o.status === 'CANCELLED' ? '❌ BEKOR QILINDI' : '⏳ KUTILMOQDA')}</span>
                </div>


                <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; font-size:12px; margin-bottom:8px;">
                  <a href="tel:${escapeHtml(o.customer_phone)}" style="color:var(--text-muted); text-decoration:none;" onclick="event.stopPropagation();">📞 ${escapeHtml(o.customer_phone)}</a>
                  ${tgLink ? `<a href="${tgLink}" target="_blank" style="background:rgba(0,136,204,0.2); color:#0088cc; padding:2px 8px; border-radius:6px; font-weight:700; text-decoration:none;" onclick="event.stopPropagation();">💬 Telegram Chat</a>` : ''}
                </div>

                ${o.customer_note ? `<div style="font-size:12px; color:var(--accent-gold); margin-bottom:8px; font-weight:600; background:rgba(255,215,0,0.1); padding:4px 8px; border-radius:6px;">💬 Mijoz izohi: "${escapeHtml(o.customer_note)}"</div>` : ''}

                <!-- Order Items — always visible -->
                <div style="margin-bottom:10px; background:rgba(255,255,255,0.03); border-radius:10px; padding:8px;">
                  <div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">📋 Buyurtma tarkibi (${items.length} ta tovar):</div>
                  ${items.length > 0 ? items.map(item => `
                    <div style="display:flex; gap:10px; align-items:center; padding:6px; border-radius:8px; margin-bottom:4px; background:rgba(255,255,255,0.03);">
                      <img src="${item.image_url || 'images/logo.jpg'}" style="width:40px; height:40px; object-fit:cover; border-radius:7px; border:1px solid rgba(255,255,255,0.1);">
                      <div style="flex-grow:1;">
                        <div style="font-size:12px; font-weight:600; color:var(--text-light);">${escapeHtml(item.title_uz || item.title_ru || 'Mahsulot')}</div>
                        ${item.size ? `<div style="font-size:10px; color:var(--primary-pink);">📏 ${escapeHtml(item.size)}</div>` : ''}
                        <div style="font-size:11px; color:var(--accent-gold);">${item.quantity || 1} dona × ${(item.price || 0).toLocaleString()} so'm</div>
                      </div>
                      <div style="font-size:12px; font-weight:700; color:var(--primary-pink);">${((item.quantity || 1) * (item.price || 0)).toLocaleString()} so'm</div>
                    </div>
                  `).join('') : '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:8px;">Tarkib ma\'lumoti yo\'q</div>'}
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${o.status === 'PENDING' ? '10px' : '0'};">
                  <span style="font-size:15px; font-weight:800; color:var(--primary-pink);">💰 Jami: ${(o.total_price || 0).toLocaleString()} so'm</span>
                  <span style="font-size:10px; color:var(--text-muted);">📦 ${new Date(o.created_at || Date.now()).toLocaleDateString('uz-UZ', {day:'2-digit', month:'2-digit', year:'numeric'})}</span>
                </div>

                ${o.status === 'PENDING' ? `
                  <div style="display:flex; gap:8px;">
                    <button class="role-btn" style="flex:1; background:#2ECC71; padding:10px; font-weight:700; font-size:13px;" onclick="updateOrderStatus(${o.id}, 'APPROVED')">✅ Tasdiqlash</button>
                    <button class="role-btn" style="flex:1; background:#E74C3C; padding:10px; font-weight:700; font-size:13px;" onclick="updateOrderStatus(${o.id}, 'CANCELLED')">❌ Bekor qilish</button>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('');

        }
      }


      // Render Store Products
      const prodList = document.getElementById('storeProductsList');
      if (prodList) {
        if (!prodData.products || prodData.products.length === 0) {
          prodList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Sizda hali mahsulotlar mavjud emas</div>`;
        } else {
          prodList.innerHTML = prodData.products.map(p => `
            <div style="display:flex; gap:12px; align-items:center; background:rgba(255,255,255,0.04); padding:10px; border-radius:12px; margin-bottom:8px;">
              <img src="${p.image_url || 'images/logo.jpg'}" style="width:45px; height:45px; object-fit:cover; border-radius:8px;">
              <div style="flex-grow:1;">
                <div style="font-size:13px; font-weight:600;">${escapeHtml(p.title_uz)}</div>
                <div style="font-size:11px; color:var(--primary-pink);">${p.price.toLocaleString()} so'm</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="role-btn" style="background:var(--primary-pink); padding:6px 10px;" onclick="editProduct(${p.id})" title="Tahrirlash"><i class="fa-solid fa-pen"></i> Tahrirlash</button>
                <button class="role-btn" style="background:#E74C3C; padding:6px 10px;" onclick="deleteProduct(${p.id})" title="O'chirish"><i class="fa-solid fa-trash"></i> O'chirish</button>
              </div>
            </div>
          `).join('');
        }
      }
  } catch (err) {
    console.error('Admin dashboard load error:', err);
  }
}


window.toggleOrderExpand = function(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
  }
};

window.openModal = function(id) {

  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    el.style.opacity = '1';
    el.style.visibility = 'visible';
    el.style.pointerEvents = 'auto';
  }
};

window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('active');
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
  }
};

window.openStoreProfileModal = function() {
  document.getElementById('editStoreNameInput').value = userStore ? (userStore.store_name || '') : '';
  document.getElementById('editStoreDescInput').value = userStore ? (userStore.description || '') : '';
  document.getElementById('editStoreLogoUrl').value = userStore ? (userStore.logo_url || '') : '';
  if (userStore && userStore.logo_url) {
    document.getElementById('storeLogoPreview').src = userStore.logo_url;
    document.getElementById('storeLogoPreviewContainer').style.display = 'block';
  }
  window.openModal('storeProfileModal');
};

window.openProductModal = function() {
  document.getElementById('productForm').reset();
  document.getElementById('editProductId').value = '';
  uploadedImagesList = [];
  renderMultiImagePreviews();
  document.getElementById('editModalTitle').textContent = "Yangi Mahsulot Qo'shish";
  window.openModal('productEditModal');
};

window.editProduct = async function(productId) {
  try {
    const res = await apiFetch(`/api/products/${productId}`);
    const data = await res.json();
    if (!data.success) return;

    const p = data.product;
    document.getElementById('editProductId').value = p.id;
    document.getElementById('prodTitleUz').value = p.title_uz || '';
    document.getElementById('prodTitleRu').value = p.title_ru || '';
    document.getElementById('prodPrice').value = p.price || '';
    document.getElementById('prodCategory').value = p.category || 'Parfyum';
    document.getElementById('prodSizes').value = (p.sizes || []).join(', ');
    document.getElementById('prodDescUz').value = p.description_uz || '';

    uploadedImagesList = p.images && p.images.length > 0 ? p.images : [p.image_url];
    renderMultiImagePreviews();

    document.getElementById('editModalTitle').textContent = "Mahsulotni Tahrirlash";
    window.openModal('productEditModal');
  } catch (err) {
    console.error('Edit product fetch error:', err);
  }
};

window.handleStoreLogoCompress = async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const result = await compressImage(file, 200, 0.8);
    document.getElementById('editStoreLogoUrl').value = result.dataUrl;
    document.getElementById('storeLogoPreview').src = result.dataUrl;
    document.getElementById('storeLogoPreviewContainer').style.display = 'block';
  } catch (err) {
    alert(err.message);
  }
};

window.saveStoreProfile = async function(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setBtnLoading(submitBtn, true, 'Saqlanmoqda...');

  if (!userStore || !userStore.id) {
    setBtnLoading(submitBtn, false);
    alert("Sizga tegishli do'kon topilmadi!");
    return;
  }
  const storeId = userStore.id;
  const store_name = document.getElementById('editStoreNameInput').value;
  const description = document.getElementById('editStoreDescInput').value;
  const logo_url = document.getElementById('editStoreLogoUrl').value;

  try {
    const res = await apiFetch('/api/admin/store-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, store_name, description, logo_url })
    });
    const data = await res.json();
    setBtnLoading(submitBtn, false);
    if (data.success) {
      userStore.store_name = store_name;
      userStore.description = description;
      userStore.logo_url = logo_url;
      window.closeModal('storeProfileModal');
      await loadAdminDashboard();
    }
  } catch (err) {
    setBtnLoading(submitBtn, false);
    alert("Xatolik: " + err.message);
  }
};

window.updateOrderStatus = async function(orderId, status) {
  await apiFetch(`/api/orders/${orderId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  await loadAdminDashboard();
};

window.deleteProduct = async function(productId) {
  if (confirm("Mahsulotni o'chirmoqchimisiz?")) {
    await apiFetch(`/api/products/${productId}`, { method: 'DELETE' });
    await loadAdminDashboard();
  }
};

window.handleMultiImageCompress = async function(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await compressImage(files[i], 450, 0.75);
      uploadedImagesList.push(result.dataUrl);
    } catch (err) {
      console.error("Multi-image compression error:", err);
    }
  }
  renderMultiImagePreviews();
};

function renderMultiImagePreviews() {
  const container = document.getElementById('multiImagePreviewContainer');
  if (!container) return;
  container.innerHTML = uploadedImagesList.map((img, idx) => `
    <div style="position:relative; width:65px; height:65px;">
      <img src="${img}" style="width:100%; height:100%; object-fit:cover; border-radius:8px; border:1px solid var(--primary-pink);">
      <button type="button" onclick="removeUploadedImage(${idx})" 
              style="position:absolute; top:-6px; right:-6px; background:#E74C3C; color:#fff; border:none; border-radius:50%; width:20px; height:20px; font-size:11px; cursor:pointer; font-weight:700;">&times;</button>
    </div>
  `).join('');
}

window.removeUploadedImage = function(idx) {
  uploadedImagesList.splice(idx, 1);
  renderMultiImagePreviews();
};

window.saveProduct = async function(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setBtnLoading(submitBtn, true, 'Saqlanmoqda...');

  if (!userStore || !userStore.id) {
    setBtnLoading(submitBtn, false);
    alert("Sizga tegishli do'kon topilmadi!");
    return;
  }
  const storeId = userStore.id;
  const editId = document.getElementById('editProductId').value;

  const payload = {
    store_id: storeId,
    telegram_id: currentUser.telegram_id,
    title_uz: document.getElementById('prodTitleUz').value,
    title_ru: document.getElementById('prodTitleRu').value || document.getElementById('prodTitleUz').value,
    price: document.getElementById('prodPrice').value,
    category: document.getElementById('prodCategory').value,
    sizes: document.getElementById('prodSizes').value.split(',').map(s => s.trim()).filter(Boolean),
    description_uz: document.getElementById('prodDescUz').value,
    description_ru: document.getElementById('prodDescUz').value,
    images: uploadedImagesList.length > 0 ? uploadedImagesList : ['https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=450&q=80']
  };


  const url = editId ? `/api/products/${editId}` : '/api/products';
  const method = editId ? 'PUT' : 'POST';

  try {
    const res = await apiFetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    setBtnLoading(submitBtn, false);

    if (data.success) {
      alert(editId ? "Mahsulot muvaffaqiyatli tahrirlandi!" : "Yangi mahsulot saqlandi va barcha obunachilarga Telegram orqali xabar yuborildi!");
      window.closeModal('productEditModal');
      await loadAdminDashboard();
    } else {
      alert(data.error);
    }
  } catch (err) {
    setBtnLoading(submitBtn, false);
    alert("Xatolik: " + err.message);
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
