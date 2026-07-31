// Super Admin App State & Controller
let currentUser = {
  telegram_id: '',
  username: '',
  full_name: '',
  role: 'SUPER_ADMIN'
};

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






  options.headers = {
    'Bypass-Tunnel-Reminder': 'true',
    ...(options.headers || {})
  };
  return fetch(targetUrl, options);
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
    // Fallback for browser testing
    currentUser.telegram_id = '1812245206';
    currentUser.username = 'Muhammadyusuf';
    currentUser.full_name = 'Muhammadyusuf (Super Admin)';
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

      // Access Security Guard: Strictly enforce SUPER_ADMIN role!
      if (currentUser.role !== 'SUPER_ADMIN') {
        alert("⚠️ Ruxsat etilmagan kirish! Siz Super Admin emassiz.");
        window.location.href = '/';
        return;
      }

      await loadSuperAdminDashboard();
    }
  } catch (err) {
    console.error('Init super admin error:', err);
  }
}

function toggleLang() {
  const newLang = currentLang === 'uz' ? 'ru' : 'uz';
  document.getElementById('langBtn').textContent = newLang.toUpperCase();
  setLanguage(newLang);
}

// Button Loading State Helper
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

// Super Admin Dashboard & Store Management
async function loadSuperAdminDashboard() {
  try {
    const res = await apiFetch('/api/super-admin/dashboard');
    const data = await res.json();

    if (data.success) {
      document.getElementById('superSales').textContent = `${(data.global_sales || 0).toLocaleString()} so'm`;
      document.getElementById('superComm').textContent = `${(data.global_commission_due || 0).toLocaleString()} so'm`;
      document.getElementById('superPaidOut').textContent = `${(data.global_paid_out || 0).toLocaleString()} so'm`;
      document.getElementById('superRemainingBalance').textContent = `${(data.global_remaining_balance || 0).toLocaleString()} so'm`;

      const storesList = document.getElementById('superStoresList');
      if (storesList) {
        storesList.innerHTML = data.stores.map(s => `
          <div class="admin-card" style="border-left:4px solid var(--accent-gold);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <div style="font-weight:700; font-size:15px; color:var(--accent-gold);">${escapeHtml(s.store_name)}</div>
                <div style="font-size:11px; color:var(--text-muted);">Egasi: ${escapeHtml(s.owner_name || 'Admin')} (ID: ${s.owner_telegram_id})</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="role-btn" style="background:#2ECC71; font-size:11px;" onclick="openPayoutModal(${s.id})">💵 Pul Olish</button>
                <button class="role-btn" style="background:#E74C3C; font-size:11px;" onclick="deleteStore(${s.id}, '${escapeHtml(s.store_name)}')">🗑️ O'chirish</button>
              </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin:12px 0 8px;">
              <div class="stat-box">
                <div class="stat-val" style="font-size:12px;">${(s.total_sales || 0).toLocaleString()}</div>
                <div class="stat-lbl">Sotuv</div>
              </div>
              <div class="stat-box">
                <div class="stat-val" style="font-size:12px; color:#2ECC71;">${(s.total_paid_out || 0).toLocaleString()}</div>
                <div class="stat-lbl">Olingan Pul</div>
              </div>
              <div class="stat-box" style="border-color:var(--primary-pink);">
                <div class="stat-val" style="font-size:12px; color:var(--primary-pink);">${(s.remaining_balance || 0).toLocaleString()}</div>
                <div class="stat-lbl">Qolgan Qarz</div>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:11px; color:var(--text-muted);">${i18n[currentLang].margin_commission}:</span>
              <input type="number" class="form-input" style="width:65px; padding:3px 6px; font-size:11px;" value="${s.commission_margin}" onchange="updateStoreMargin(${s.id}, this.value)">
              <span style="font-size:11px; font-weight:700;">%</span>
            </div>
          </div>
        `).join('');
      }

      const payoutsList = document.getElementById('superPayoutsList');
      if (payoutsList) {
        payoutsList.innerHTML = (data.payouts || []).map(p => `
          <div style="background:rgba(255,255,255,0.04); padding:10px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; font-size:12px;">
            <div>
              <div style="font-weight:700; color:var(--accent-gold);">${escapeHtml(p.store_name)}</div>
              <div style="color:var(--text-muted);">${escapeHtml(p.note || '')}</div>
            </div>
            <div style="font-weight:800; color:#2ECC71;">+${p.amount.toLocaleString()} so'm</div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Super admin dashboard error:', err);
  }
}

// Delete Store (Super Admin)
window.deleteStore = async function(storeId, storeName) {
  if (confirm(`⚠️ "${storeName}" do'konini platformadan o'chirib yubormoqchimisiz?\nUshbu do'kon va uning barcha mahsulotlari bozordan to'liq olib tashlanadi.`)) {
    try {
      const res = await apiFetch(`/api/super-admin/stores/${storeId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert(`🗑️ "${storeName}" do'koni muvaffaqiyatli o'chirildi!`);
        loadSuperAdminDashboard();
      }
    } catch (err) {
      console.error('Delete store error:', err);
    }
  }
};

window.openCreateStoreModal = function() {
  document.getElementById('newOwnerId').value = '';
  document.getElementById('newStoreName').value = '';
  document.getElementById('newStoreDesc').value = '';
  openModal('createStoreModal');
};

window.submitCreateStore = async function(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setBtnLoading(submitBtn, true, 'Yaratilmoqda...');

  const owner_telegram_id = document.getElementById('newOwnerId').value.trim();
  const store_name = document.getElementById('newStoreName').value.trim();
  const description = document.getElementById('newStoreDesc').value.trim();
  const commission_margin = document.getElementById('newStoreMargin').value.trim();

  try {
    const res = await apiFetch('/api/super-admin/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_telegram_id, store_name, description, commission_margin })
    });
    const data = await res.json();
    setBtnLoading(submitBtn, false);

    if (data.success) {
      alert("🎉 Yangi do'kon va do'kon egasi muvaffaqiyatli yaratildi!");
      closeModal('createStoreModal');
      loadSuperAdminDashboard();
    } else {
      alert(data.error || "Do'kon qo'shishda xatolik yuz berdi");
    }
  } catch (err) {
    setBtnLoading(submitBtn, false);
    alert("Xatolik: " + err.message);
  }
};

window.updateStoreMargin = async function(storeId, margin) {
  await apiFetch('/api/super-admin/store-margin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: storeId, commission_margin: margin })
  });
  loadSuperAdminDashboard();
};

window.openPayoutModal = function(storeId) {
  document.getElementById('payoutStoreId').value = storeId;
  document.getElementById('payoutForm').reset();
  openModal('payoutModal');
};

window.submitPayout = async function(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setBtnLoading(submitBtn, true, 'Qayd etilmoqda...');

  const storeId = document.getElementById('payoutStoreId').value;
  const amount = document.getElementById('payoutAmount').value;
  const note = document.getElementById('payoutNote').value;

  try {
    await apiFetch('/api/super-admin/payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, amount, note })
    });
    setBtnLoading(submitBtn, false);
    closeModal('payoutModal');
    loadSuperAdminDashboard();
  } catch (err) {
    setBtnLoading(submitBtn, false);
    alert("Xatolik: " + err.message);
  }
window.submitBroadcastMsg = async function(btn) {
  const input = document.getElementById('broadcastMsgInput');
  const message = input ? input.value.trim() : '';

  if (!message) {
    alert("Iltimos, xabar matnini kiriting!");
    return;
  }

  if (!confirm("Barcha bot foydalanuvchilariga ushbu xabarni tarqatmoqchimisiz?")) {
    return;
  }

  setBtnLoading(btn, true, 'Yuborilmoqda...');

  try {
    const res = await apiFetch('/api/super-admin/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_telegram_id: currentUser.telegram_id || '1812245206',
        message
      })
    });

    const data = await res.json();
    setBtnLoading(btn, false);

    if (data.success) {
      alert(data.message);
      if (input) input.value = '';
    } else {
      alert("Xatolik: " + (data.error || 'Noma\'lum xatolik'));
    }
  } catch (err) {
    setBtnLoading(btn, false);
    alert("Xatolik: " + err.message);
  }
};

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
