import { supabase, API_BASE } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

(async () => {
  await window.requireRole(["admin"]);
})();

const TERMINAL = ["Cancelled", "Rejected", "Completed", "Delivered"];
const DONE = ["Completed", "Delivered"];
const isActiveOrder = (s) => !TERMINAL.includes(s);
const isDoneOrder = (s) => DONE.includes(s);

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}
function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtMoney(n) {
  const v = Number(n) || 0;
  return '₱' + Math.round(v).toLocaleString('en-PH');
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return esc(s);
  return d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}
function statusClass(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'pending') return 'pending';
  if (v === 'under review' || v === 'under_review') return 'under-review';
  if (v === 'revision required' || v === 'revision') return 'revision';
  if (v === 'approved' || v === 'pending signing') return 'approved';
  if (v === 'completed' || v === 'delivered' || v === 'paid') return 'completed';
  if (v === 'cancelled' || v === 'rejected') return 'cancelled';
  if (v.includes('progress') || v === 'construction') return 'in-progress';
  if (v.includes('payment') || v === 'full payment') return 'full-payment';
  return 'approved';
}
function orderKey(email) {
  return String(email || '').toLowerCase();
}

let allCustomers = [];
let allOrders = [];
let allApprovedPayments = [];
let currentFilter = 'all';
let currentSort = 'revenue';
let currentSearch = '';
let detailCustomer = null;

async function fetchAll() {
  const [profilesRes, ordersRes, payRes] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("boat_orders").select("*"),
    supabase.from("dashboard_payments").select("*").eq("status", "Approved"),
  ]);
  return {
    profiles: (profilesRes.data || []).filter(p => p.role === 'customer' || p.role === 'user'),
    orders: ordersRes.data || [],
    payments: payRes.data || [],
  };
}

function buildCustomers(profiles, orders, payments) {
  const byEmail = new Map();
  profiles.forEach(p => {
    const key = orderKey(p.email);
    byEmail.set(key, {
      profile: p,
      name: p.name || p.email || 'Unknown',
      email: p.email || '',
      phone: p.phone || '—',
      photo: p.photo || './images/user.png',
      joined: p.created_at || '',
      orders: [],
      payments: [],
      orderCount: 0,
      revenue: 0,
      lastOrderAt: null,
      activeBuilds: 0,
      completedOrders: 0,
    });
  });
  orders.forEach(o => {
    const key = orderKey(o.customerEmail);
    const cust = byEmail.get(key);
    if (!cust) return;
    cust.orders.push(o);
    cust.orderCount += 1;
    if (o.createdAt && (!cust.lastOrderAt || new Date(o.createdAt) > new Date(cust.lastOrderAt))) cust.lastOrderAt = o.createdAt;
    if (isActiveOrder(o.status)) cust.activeBuilds += 1;
    if (isDoneOrder(o.status)) cust.completedOrders += 1;
  });
  payments.forEach(p => {
    const key = orderKey(p.customerEmail);
    const cust = byEmail.get(key);
    if (!cust) return;
    cust.payments.push(p);
    cust.revenue += Number(p.amount) || 0;
  });
  return Array.from(byEmail.values());
}

function filterAndSort() {
  let rows = allCustomers.slice();
  if (currentFilter === 'active') rows = rows.filter(c => c.activeBuilds > 0);
  else if (currentFilter === 'completed') rows = rows.filter(c => c.completedOrders > 0);
  else if (currentFilter === 'none') rows = rows.filter(c => c.orderCount === 0);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    rows = rows.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      c.orders.some(o => String(o.boatName || '').toLowerCase().includes(q))
    );
  }
  if (currentSort === 'revenue') rows.sort((a, b) => b.revenue - a.revenue);
  else if (currentSort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  else if (currentSort === 'recent') rows.sort((a, b) => new Date(b.joined || 0) - new Date(a.joined || 0));
  return rows;
}

function renderStats(rows) {
  const total = rows.length;
  const active = rows.filter(c => c.activeBuilds > 0).length;
  const completed = rows.reduce((s, c) => s + c.completedOrders, 0);
  const revenue = rows.reduce((s, c) => s + c.revenue, 0);
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statActive').textContent = active;
  document.getElementById('statCompleted').textContent = completed;
  document.getElementById('statRevenue').textContent = fmtMoney(revenue);
}

function renderTable(rows) {
  const tbody = document.getElementById('customerTable');
  const emptyEl = document.getElementById('customerEmpty');
  if (!rows.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = rows.map(c => `
    <tr>
      <td>
        <div class="customer-cell">
          <img src="${escAttr(c.photo)}" onerror="this.src='./images/user.png'" alt="">
          <div>
            <h4>${esc(c.name)}</h4>
            <p>${esc(c.email)}</p>
          </div>
        </div>
      </td>
      <td>${c.orderCount}${c.activeBuilds ? `<div class="muted" style="margin-top:2px;">${c.activeBuilds} active</div>` : ''}</td>
      <td class="money">${c.revenue ? fmtMoney(c.revenue) : '<span class="muted">—</span>'}</td>
      <td>${fmtDate(c.lastOrderAt)}</td>
      <td><span class="status-pill ${c.activeBuilds > 0 ? 'active' : (c.completedOrders > 0 ? 'completed' : 'none')}">${c.activeBuilds > 0 ? 'Active build' : (c.completedOrders > 0 ? 'Completed' : 'No orders')}</span></td>
      <td><button class="view-btn" data-email="${escAttr(c.email)}">Manage</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = allCustomers.find(x => x.email === btn.dataset.email);
      if (c) openCustomerModal(c);
    });
  });
}

function render() {
  const rows = filterAndSort();
  renderStats(rows);
  renderTable(rows);
}

function openCustomerModal(c) {
  detailCustomer = c;
  document.getElementById('viewPhoto').src = c.photo;
  document.getElementById('viewName').textContent = c.name;
  document.getElementById('viewEmail').textContent = c.email;
  document.getElementById('viewPhone').textContent = c.phone;
  document.getElementById('viewEmail2').textContent = c.email;
  document.getElementById('viewJoined').textContent = fmtDate(c.joined);
  document.getElementById('viewAccountBadge').innerHTML = '<i class="fa-solid fa-circle-check"></i> Active account';
  document.getElementById('callBtn').href = 'tel:' + c.phone;
  document.getElementById('emailBtn').href = 'mailto:' + c.email;
  document.getElementById('orderCount').textContent = c.orders.length;
  document.getElementById('paymentsCount').textContent = c.payments.length;

  const ordersList = document.getElementById('ordersList');
  if (!c.orders.length) {
    ordersList.innerHTML = '<div class="list-empty">No orders yet.</div>';
  } else {
    ordersList.innerHTML = c.orders.map(o => {
      const s = String(o.status || '');
      return `
      <div class="list-card">
        <div class="list-card-row">
          <strong>${esc(o.boatName || 'Boat')}</strong>
          <span class="list-pill">${esc(o.buildType || 'standard')}</span>
          <span class="list-gap view-link" style="${o.status === 'Completed' || o.status === 'Delivered' ? 'color:#16a34a;' : ''}"><i class="fa-solid fa-peso-sign"></i> ${o.boatPrice || '—'}</span>
        </div>
        <div class="list-card-row" style="margin-top:6px;">
          <span class="order-id">${esc(o.orderId)}</span>
          <span class="list-status ${statusClass(s)}">${esc(s || '—')}</span>
          ${o.progress != null ? `<span class="list-pill" style="background:#eff6ff;color:#2563eb;">${o.progress}%</span>` : ''}
          <span class="list-card-sub">${fmtDate(o.createdAt)}</span>
        </div>
      </div>`;
    }).join('');
  }

  const paymentsList = document.getElementById('paymentsList');
  if (!c.payments.length) {
    paymentsList.innerHTML = '<div class="list-empty">No approved payments yet.</div>';
  } else {
    paymentsList.innerHTML = c.payments
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(p => `
      <div class="payment-row">
        <div>
          <div class="meta">${esc(p.orderId || '—')} · ${esc(p.bank || '—')}</div>
          <div class="meta">Ref: ${esc(p.reference || '—')} · ${fmtDate(p.createdAt)}</div>
        </div>
        <div class="status approved">Approved</div>
        <div class="amt">${fmtMoney(p.amount)}</div>
      </div>`).join('');
  }

  document.getElementById('customerViewModal').classList.add('show');
}

window.closeCustomerModal = function() {
  document.getElementById('customerViewModal').classList.remove('show');
};

/* ======= DELETE FLOW ======= */
window.openDeleteModal = function() {
  if (!detailCustomer) return;
  document.getElementById('deleteNameDisplay').textContent = detailCustomer.name;
  document.getElementById('typedNameInput').value = '';
  document.getElementById('confirmDeleteBtn').disabled = true;
  document.getElementById('deleteCustomerModal').classList.add('show');
  document.getElementById('typedNameInput').focus();
};

window.closeDeleteModal = function() {
  document.getElementById('deleteCustomerModal').classList.remove('show');
};

document.getElementById('deleteCustomerBtn').addEventListener('click', () => window.openDeleteModal());
document.getElementById('typedNameInput').addEventListener('input', function() {
  const expected = (detailCustomer?.name || '').trim().toLowerCase();
  const typed = this.value.trim().toLowerCase();
  document.getElementById('confirmDeleteBtn').disabled = !expected || typed !== expected;
});

document.getElementById('cancelDeleteBtn').addEventListener('click', () => window.closeDeleteModal());
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!detailCustomer) return;
  const expected = detailCustomer.name.trim().toLowerCase();
  const typed = document.getElementById('typedNameInput').value.trim().toLowerCase();
  if (typed !== expected) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(API_BASE + '/users/' + encodeURIComponent(detailCustomer.profile.id), {
      method: 'DELETE',
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Delete failed (HTTP ' + res.status + ')');
    showToast('Customer account permanently deleted', 'success');
    window.closeDeleteModal();
    document.getElementById('customerViewModal').classList.remove('show');
    detailCustomer = null;
    await load();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = 'Delete Forever';
  }
});

/* ======= FILTER / SEARCH / SORT ======= */
async function load() {
  const { profiles, orders, payments } = await fetchAll();
  allCustomers = buildCustomers(profiles, orders, payments);
  render();
}
document.getElementById('searchInput').addEventListener('input', function() {
  currentSearch = this.value.trim();
  render();
});
document.getElementById('sortSelect').addEventListener('change', function() {
  currentSort = this.value;
  render();
});
document.getElementById('filterChips').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  currentFilter = chip.dataset.filter;
  render();
});

/* ======= INIT ======= */
(async function init() {
  await load();
  window.copyToClipboard = async function() {
    const btn = document.activeElement;
    const text = btn?.dataset?.copy || '';
    if (!text) return;
    try { await navigator.clipboard.writeText(text); showToast('Copied', 'success'); } catch { showToast('Clipboard blocked', 'error'); }
  };

  document.getElementById('copyPhoneBtn').addEventListener('click', () => {
    const t = detailCustomer?.phone; if (!t || t === '—') { showToast('No phone on file', 'warning'); return; }
    navigator.clipboard.writeText(t).then(() => showToast('Phone copied', 'success')).catch(() => showToast('Clipboard blocked', 'error'));
  });
  document.getElementById('copyEmailBtn').addEventListener('click', () => {
    const t = detailCustomer?.email; if (!t) { showToast('No email on file', 'warning'); return; }
    navigator.clipboard.writeText(t).then(() => showToast('Email copied', 'success')).catch(() => showToast('Clipboard blocked', 'error'));
  });
})();

function showToast(msg, type) {
  try { if (typeof window.showToast === 'function') return window.showToast(msg, type); } catch (_) {}
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#071b47;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;z-index:10000;box-shadow:0 10px 30px rgba(7,27,71,.35);';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
