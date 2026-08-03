// Super Admin App State & Controller
let currentUser = {
  telegram_id: '1812245206',
  username: 'Muhammadyusuf',
  full_name: 'Muhammadyusuf (Super Admin)',
  role: 'SUPER_ADMIN'
};
// NOTE: `currentLang` is declared with `let` in i18n.js (loaded before this
// file) — redeclaring it here with `var` throws a fatal SyntaxError at parse
// time ("Identifier 'currentLang' has already been declared"), which used to
// stop this entire script from running at all (no buttons, no data, nothing).

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
    // Fallback for browser testing
    currentUser.telegram_id = '1812245206';
    currentUser.username = 'Muhammadyusuf';
    currentUser.full_name = 'Muhammadyusuf (Super Admin)';
  }

  await initUser();
});

async function initUser() {
  let authorized = false;
  try {
    const res = await apiFetch('/api/init-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUser)
    });
    const data = await res.json();

    if (data.success && data.user) {
      currentUser = {
        ...data.user,
        telegram_id: currentUser.telegram_id || data.user.telegram_id
      };

      // Access Security Guard: Strictly enforce SUPER_ADMIN role!
      if (currentUser.role !== 'SUPER_ADMIN') {
        alert("⚠️ Ruxsat etilmagan kirish! Siz Super Admin emassiz.");
        window.location.href = '/';
      } else {
        authorized = true;
      }
    } else {
      alert("⚠️ Autentifikatsiya muvaffaqiyatsiz tugadi.");
      window.location.href = '/';
    }
  } catch (err) {
    console.error('Init super admin error:', err);
  }

  if (authorized) {
    await loadSuperAdminDashboard();
  }
}


function toggleLang() {
  currentLang = currentLang === 'uz' ? 'ru' : 'uz';
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.textContent = currentLang.toUpperCase();
}
window.toggleLang = toggleLang;

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
      const sSales = document.getElementById('superSales');
      const sComm = document.getElementById('superComm');
      const sPaid = document.getElementById('superPaidOut');
      const sRem = document.getElementById('superRemainingBalance');

      if (sSales) sSales.textContent = `${(data.global_sales || 0).toLocaleString()} so'm`;
      if (sComm) sComm.textContent = `${(data.global_commission_due || 0).toLocaleString()} so'm`;
      if (sPaid) sPaid.textContent = `${(data.global_paid_out || 0).toLocaleString()} so'm`;
      if (sRem) sRem.textContent = `${(data.global_remaining_balance || 0).toLocaleString()} so'm`;

      const storesList = document.getElementById('superStoresList');
      if (storesList) {
        if (!data.stores || data.stores.length === 0) {
          storesList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Do'konlar mavjud emas</div>`;
        } else {
          storesList.innerHTML = data.stores.map(s => `
            <div class="admin-card" style="border-left:4px solid var(--accent-gold); margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <div style="font-weight:700; font-size:15px; color:var(--accent-gold);">${escapeHtml(s.store_name)}</div>
                  <div style="font-size:11px; color:var(--text-muted);">${s.owner_telegram_id ? `Egasi: ${escapeHtml(s.owner_name || 'Admin')} (ID: ${s.owner_telegram_id})` : `<span style="color:#E67E22;">⏳ Hali egasi tasdiqlanmagan</span>`}</div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  ${!s.owner_telegram_id ? `<button class="role-btn" style="background:#F39C12; font-size:11px;" onclick="generateInviteLink(${s.id})">🔗 Havola</button>` : ''}
                  <button class="role-btn" style="background:#2ECC71; font-size:11px;" onclick="openPayoutModal(${s.id})">💵 Pul Olish</button>
                  <button class="role-btn" style="background:#3498DB; font-size:11px;" onclick="openChangeOwnerModal(${s.id}, '${escapeHtml(String(s.owner_telegram_id || ''))}')">🔄 Egasi</button>
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
                <span style="font-size:11px; color:var(--text-muted);">Komissiya foizi:</span>
                <input type="number" class="form-input" style="width:65px; padding:3px 6px; font-size:11px;" value="${s.commission_margin}" onchange="updateStoreMargin(${s.id}, this.value)">
                <span style="font-size:11px; font-weight:700;">%</span>
              </div>
            </div>
          `).join('');
        }
      }

      const payoutsList = document.getElementById('superPayoutsList');
      if (payoutsList) {
        if (!data.payouts || data.payouts.length === 0) {
          payoutsList.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">Hali to'lovlar yozuvlari mavjud emas</div>`;
        } else {
          payoutsList.innerHTML = data.payouts.map(p => `
            <div style="background:rgba(255,255,255,0.04); padding:10px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; font-size:12px;">
              <div>
                <div style="font-weight:700; color:var(--accent-gold);">${escapeHtml(p.store_name)}</div>
                <div style="color:var(--text-muted);">${escapeHtml(p.note || '')}</div>
              </div>
              <div style="font-weight:800; color:#2ECC71;">+${(p.amount || 0).toLocaleString()} so'm</div>
            </div>
          `).join('');
        }
      }

      // Render Global Sales & Orders History
      const ordersList = document.getElementById('superGlobalOrdersList');
      if (ordersList) {
        if (!data.orders || data.orders.length === 0) {
          ordersList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">Hali sotuvlar tarixi mavjud emas</div>`;
        } else {
          ordersList.innerHTML = data.orders.map(o => {
            let items = [];
            try { items = JSON.parse(o.items_json || '[]'); } catch(e){}
            const statusColor = o.status === 'APPROVED' ? '#2ECC71' : (o.status === 'CANCELLED' ? '#E74C3C' : 'var(--accent-gold)');
            const statusText = o.status === 'APPROVED' ? '✅ TASDIQLANDI' : (o.status === 'CANCELLED' ? '❌ BEKOR QILINDI' : '⏳ KUTILMOQDA');
            const tgLink = o.customer_telegram_id && /^\d+$/.test(o.customer_telegram_id) ? `tg://user?id=${o.customer_telegram_id}` : null;

            return `
              <div class="admin-card" style="border-left:4px solid ${statusColor}; margin-bottom:12px; background:rgba(255,255,255,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span style="font-weight:700; font-size:14px; color:var(--text-light);">
                    #${o.id} | ${tgLink ? `<a href="${tgLink}" target="_blank" style="color:var(--primary-pink); text-decoration:underline;">${escapeHtml(o.customer_name)}</a>` : escapeHtml(o.customer_name)}
                  </span>
                  <span class="order-badge" style="font-size:11px; font-weight:700; color:${statusColor}; border:1px solid ${statusColor}; padding:2px 6px; border-radius:6px;">${statusText}</span>
                </div>

                <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">
                  🏪 <strong>Do'kon:</strong> ${escapeHtml(o.store_name || 'BeautyGo')} | 📞 <strong>Tel:</strong> ${escapeHtml(o.customer_phone || '')}
                </div>

                ${o.customer_note ? `<div style="font-size:11px; color:var(--accent-gold); margin-bottom:6px; font-weight:600; background:rgba(255,215,0,0.1); padding:4px 8px; border-radius:6px;">💬 Izoh: "${escapeHtml(o.customer_note)}"</div>` : ''}

                <!-- Items list -->
                <div style="background:rgba(0,0,0,0.2); border-radius:8px; padding:6px 10px; margin-top:6px;">
                  <div style="font-size:10px; font-weight:700; color:var(--primary-pink); text-transform:uppercase; margin-bottom:4px;">📋 Tovarlar (${items.length} ta):</div>
                  ${items.map(it => `
                    <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; color:var(--text-muted);">
                      <span>- ${escapeHtml(it.title_uz || it.title_ru || '')} ${it.size ? '('+it.size+')' : ''} x${it.quantity || 1}</span>
                      <span style="color:var(--text-light); font-weight:600;">${((it.quantity||1)*(it.price||0)).toLocaleString()} so'm</span>
                    </div>
                  `).join('')}
                </div>

                <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:12px; font-weight:700;">
                  <span style="color:var(--accent-gold);">💰 Jami: ${(o.total_price || 0).toLocaleString()} so'm</span>
                  <span style="color:var(--text-muted); font-size:10px;">📅 ${new Date(o.created_at || Date.now()).toLocaleDateString('uz-UZ')}</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // Render Registered Bot Users List
      const usersList = document.getElementById('superUsersList');
      if (usersList) {
        if (!data.users || data.users.length === 0) {
          usersList.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">Hali foydalanuvchilar topilmadi</div>`;
        } else {
          usersList.innerHTML = data.users.map(u => {
            const isNumericId = u.telegram_id && /^\d+$/.test(u.telegram_id);
            const tgProfileLink = isNumericId ? `tg://user?id=${u.telegram_id}` : null;
            const roleBadgeColor = u.role === 'SUPER_ADMIN' ? 'var(--accent-gold)' : (u.role === 'ADMIN' ? '#2ECC71' : 'var(--primary-pink)');

            return `
              <div style="background:rgba(255,255,255,0.04); padding:10px 12px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <div>
                  <div style="font-weight:700; color:var(--text-light);">
                    👤 ${tgProfileLink ? `<a href="${tgProfileLink}" target="_blank" style="color:var(--text-light); text-decoration:underline;">${escapeHtml(u.full_name || 'Foydalanuvchi')}</a>` : escapeHtml(u.full_name || 'Foydalanuvchi')}
                    ${u.username ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(@${escapeHtml(u.username)})</span>` : ''}
                  </div>
                  <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">ID: ${escapeHtml(u.telegram_id)} | Qatnashdi: ${new Date(u.created_at || Date.now()).toLocaleDateString('uz-UZ')}</div>
                </div>

                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:10px; font-weight:700; color:${roleBadgeColor}; border:1px solid ${roleBadgeColor}; padding:2px 6px; border-radius:6px;">${u.role || 'USER'}</span>
                  ${tgProfileLink ? `<a href="${tgProfileLink}" target="_blank" class="role-btn" style="background:#0088cc; font-size:10px; padding:4px 8px; text-decoration:none;">💬 Chat</a>` : ''}
                </div>
              </div>
            `;
          }).join('');
        }
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
      closeModal('createStoreModal');
      loadSuperAdminDashboard();
      if (data.invite_link) {
        showInviteLink(data.invite_link);
      } else {
        alert("🎉 Yangi do'kon va do'kon egasi muvaffaqiyatli yaratildi!");
      }
    } else {
      alert(data.error || "Do'kon qo'shishda xatolik yuz berdi");
    }
  } catch (err) {
    setBtnLoading(submitBtn, false);
    alert("Xatolik: " + err.message);
  }
};

function showInviteLink(link) {
  document.getElementById('inviteLinkDisplay').value = link;
  openModal('inviteLinkModal');
}

window.copyInviteLink = function() {
  const input = document.getElementById('inviteLinkDisplay');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    alert('✅ Nusxalandi!');
  }).catch(() => {
    document.execCommand('copy');
    alert('✅ Nusxalandi!');
  });
};

window.generateInviteLink = async function(storeId) {
  try {
    const res = await apiFetch(`/api/super-admin/stores/${storeId}/invite-link`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showInviteLink(data.invite_link);
    } else {
      alert(data.error || "Taklif havolasini yaratishda xatolik");
    }
  } catch (err) {
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

// Change Store Owner (Super Admin)
window.openChangeOwnerModal = function(storeId, currentOwnerId) {
  document.getElementById('changeOwnerStoreId').value = storeId;
  document.getElementById('currentOwnerDisplay').value = currentOwnerId;
  document.getElementById('newOwnerIdInput').value = '';
  openModal('changeOwnerModal');
};

window.submitChangeOwner = async function(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  setBtnLoading(submitBtn, true, 'Almashtirilmoqda...');

  const storeId = document.getElementById('changeOwnerStoreId').value;
  const new_owner_telegram_id = document.getElementById('newOwnerIdInput').value.trim();

  try {
    const res = await apiFetch(`/api/super-admin/stores/${storeId}/owner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_owner_telegram_id })
    });
    const data = await res.json();
    setBtnLoading(submitBtn, false);

    if (data.success) {
      alert("✅ Do'kon egasi muvaffaqiyatli almashtirildi!");
      closeModal('changeOwnerModal');
      loadSuperAdminDashboard();
    } else {
      alert(data.error || "Egasini almashtirishda xatolik yuz berdi");
    }
  } catch (err) {
    setBtnLoading(submitBtn, false);
    alert("Xatolik: " + err.message);
  }
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
};

window.submitBroadcastMsg = async function(btn) {
  const input = document.getElementById('broadcastMsgInput');
  const mediaTypeEl = document.getElementById('broadcastMediaType');
  const mediaUrlEl = document.getElementById('broadcastMediaUrl');
  const btnTextEl = document.getElementById('broadcastBtnText');
  const btnUrlEl = document.getElementById('broadcastBtnUrl');

  const message = input ? input.value.trim() : '';
  const media_type = mediaTypeEl ? mediaTypeEl.value : 'none';
  const media_url = mediaUrlEl ? mediaUrlEl.value.trim() : '';
  const button_text = btnTextEl ? btnTextEl.value.trim() : '';
  const button_url = btnUrlEl ? btnUrlEl.value.trim() : '';

  if (!message) {
    alert("Iltimos, post yoki e'lon matnini kiriting!");
    return;
  }

  if (!confirm("Barcha bot foydalanuvchilariga ushbu post va reklamani tarqatmoqchimisiz?")) {
    return;
  }

  setBtnLoading(btn, true, 'Yuborilmoqda...');

  try {
    const res = await apiFetch('/api/super-admin/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_telegram_id: currentUser.telegram_id || '1812245206',
        message,
        media_type,
        media_url,
        button_text,
        button_url
      })
    });

    const data = await res.json();
    setBtnLoading(btn, false);

    if (data.success) {
      alert(data.message);
      if (input) input.value = '';
      if (mediaUrlEl) mediaUrlEl.value = '';
      if (btnTextEl) btnTextEl.value = '';
      if (btnUrlEl) btnUrlEl.value = '';
    } else {
      alert("Xatolik: " + (data.error || 'Noma\'lum xatolik'));
    }
  } catch (err) {
    setBtnLoading(btn, false);
    alert("Xatolik: " + err.message);
  }
};

window.handleBroadcastFileSelect = function(input) {

  const file = input.files && input.files[0];
  const statusEl = document.getElementById('broadcastFileStatus');
  const mediaUrlEl = document.getElementById('broadcastMediaUrl');
  const mediaTypeEl = document.getElementById('broadcastMediaType');

  if (!file) return;

  if (statusEl) statusEl.textContent = '⏳ Fayl oqilmoqda...';

  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    if (mediaUrlEl) mediaUrlEl.value = dataUrl;
    if (mediaTypeEl) {
      if (file.type.startsWith('video/')) {
        mediaTypeEl.value = 'video';
      } else {
        mediaTypeEl.value = 'photo';
      }
    }
    if (statusEl) statusEl.textContent = '✅ Fayl muvaffaqiyatli tanlandi!';
  };
  reader.readAsDataURL(file);
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
