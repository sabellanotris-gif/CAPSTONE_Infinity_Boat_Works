/* =========================================================
   Workers v2 — Admin authority view
   Roster + availability + register/create + deactivate/delete.
   Manager sees this page in read-only mode (no create/edit/delete).
   ========================================================= */
import { supabase, API_BASE } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

let allWorkers = [];
let allRegistrations = [];
let currentRole = 'admin';
let detailDeleteId = null;
let detailDeleteWorker = null;

function escHtml(s) {
  try { return window.escapeHtml ? window.escapeHtml(s || '') : String(s || ''); } catch { return String(s || ''); }
}
function escAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return escHtml(s);
  return d.toLocaleDateString('en-PH', { day:'numeric', month:'short', year:'numeric' });
}
function getToken() {
  return supabase.auth.getSession().then(s => s?.data?.session?.access_token);
}
function isAdmin() { return currentRole === 'admin'; }

function colorForName(name) {
  var hash = 0;
  for (var i = 0; i < (name || '?').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  var palette = ['#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#4f46e5','#0d9488'];
  return palette[hash % palette.length];
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
}

/* ============ AUTH + INIT ============ */
(async function init() {
  var auth = await window.requireRole(["admin", "manager"]);
  if (!auth) return;
  currentRole = auth.profile.role || 'admin';

  // Manager role: hide admin-only tabs and actions (read-only roster view)
  if (currentRole === 'manager') {
    document.getElementById('tabRegistrations').style.display = 'none';
    document.querySelectorAll('.ww-tab').forEach(function(t) {
      var tab = t.getAttribute('data-tab');
      if (tab === 'registrations') t.style.display = 'none';
    });
    document.getElementById('quickAddBtn').style.display = 'none';
    document.getElementById('createAccountBtn').style.display = 'none';
  }

  await loadWorkers();
  if (isAdmin()) await loadRegistrations();

  wireButtons();
})();

function wireButtons() {
  document.getElementById('quickAddBtn')?.addEventListener('click', function() {
    document.getElementById('quickName').value = '';
    document.getElementById('quickSpecialty').value = 'Builder';
    document.getElementById('quickPhone').value = '';
    openWorkerModal('quickAddModal');
  });
  document.getElementById('createAccountBtn')?.addEventListener('click', function() {
    document.getElementById('createAccountForm').reset();
    document.getElementById('caSpecialty').value = 'Builder';
    openWorkerModal('createAccountModal');
  });

  document.getElementById('quickAddForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = document.getElementById('quickAddSubmit');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';
    try {
      var name = document.getElementById('quickName').value.trim();
      var phone = document.getElementById('quickPhone').value.trim();
      var specialty = document.getElementById('quickSpecialty').value;
      var token = await getToken();
      var res = await fetch(API_BASE + '/workers/master', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ name, specialty, phone })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Add failed');
      showToast('Worker added to roster', 'success');
      closeWorkerModal('quickAddModal');
      await loadWorkers();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Add to Roster'; }
  });

  document.getElementById('createAccountForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = document.getElementById('createAccountSubmit');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
    try {
      var name = document.getElementById('caName').value.trim();
      var email = document.getElementById('caEmail').value.trim();
      var phone = document.getElementById('caPhone').value.trim();
      var specialty = document.getElementById('caSpecialty').value;
      var password = document.getElementById('caPassword').value;
      var confirmPassword = document.getElementById('caConfirmPassword').value;
      if (password !== confirmPassword) { alert('Passwords do not match.'); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Create &amp; Send Credentials'; return; }
      var token = await getToken();
      var res = await fetch(API_BASE + '/admin/create-worker', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ fullname: name, email, phone, specialty, password })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Create failed');
      showToast('Worker account created — credentials emailed to ' + email, 'success');
      closeWorkerModal('createAccountModal');
      await loadWorkers();
      if (isAdmin()) await loadRegistrations();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Create &amp; Send Credentials'; }
  });

  document.getElementById('workerEditForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!isAdmin()) return;
    var btn = document.getElementById('workerEditSubmit');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    try {
      var id = document.getElementById('editWorkerId').value;
      var name = document.getElementById('editName').value.trim();
      var phone = document.getElementById('editPhone').value.trim();
      var email = document.getElementById('editEmail').value.trim();
      var specialty = document.getElementById('editSpecialty').value;
      var token = await getToken();
      var res = await fetch(API_BASE + '/workers/master/' + encodeURIComponent(id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ name, phone, email, specialty })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Save failed');
      showToast('Worker updated', 'success');
      closeWorkerModal('workerEditModal');
      await loadWorkers();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }
  });

  // Delete confirm modal typing check
  document.getElementById('deleteTypedName')?.addEventListener('input', function() {
    var target = (detailDeleteWorker && detailDeleteWorker.name || '').trim().toLowerCase();
    document.getElementById('workerDeleteConfirmBtn').disabled = this.value.trim().toLowerCase() !== target;
  });
  document.getElementById('workerDeleteConfirmBtn')?.addEventListener('click', async function() {
    if (!detailDeleteWorker) return;
    var btn = this;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
    try {
      var token = await getToken();
      var res = await fetch(API_BASE + '/workers/master/' + encodeURIComponent(detailDeleteWorker.id), {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
      });
      var body = await res.json().catch(function() { return {}; });
      if (!res.ok) throw new Error(body.error || 'Delete failed (HTTP ' + res.status + ')');
      showToast('Worker permanently deleted', 'success');
      closeWorkerModal('deleteModal');
      await loadWorkers();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete Forever'; }
  });
}
window.openWorkerModal = function(id) {
  document.getElementById(id).classList.add('show');
};
window.closeWorkerModal = function(id) {
  document.getElementById(id).classList.remove('show');
};

/* ============ STATS + RENDER ============ */
async function loadWorkers() {
  var grid = document.getElementById("workersGrid");
  grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading workers...</p></div>';
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + "/admin/workers-detail", { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    allWorkers = await res.json();
    renderAllStats();
    renderWorkers(allWorkers);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><h3>Failed to load workers</h3><p>Try refreshing the page.</p></div>';
  }
}
function renderAllStats() {
  document.getElementById("statTotal").textContent = allWorkers.length;
  document.getElementById("statActive").textContent = allWorkers.filter(w => w.status === "Active").length;
  document.getElementById("statBusy").textContent = allWorkers.filter(w => !w.available).length;
  document.getElementById("statAvailable").textContent = allWorkers.filter(w => w.available && w.status === "Active").length;
}

function renderWorkers(workers) {
  var grid = document.getElementById("workersGrid");
  var empty = document.getElementById("workersEmpty");
  if (!workers.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  grid.innerHTML = workers.map(function(w) {
    var roleCanEdit = isAdmin();
    var badgeClass = w.status === 'Active' ? 'wc-badge active' : 'wc-badge inactive';
    var badgeText = w.status === 'Active' ? 'ACTIVE' : 'INACTIVE';
    var accountChip = w.hasAccount
      ? '<span class="wc-chip linked"><i class="fa-solid fa-link"></i> Linked Account</span>'
      : '<span class="wc-chip roster"><i class="fa-solid fa-clipboard"></i> Roster Only</span>';
    var availableChip = w.available
      ? '<span class="wc-chip available"><i class="fa-solid fa-circle-check"></i> Ready</span>'
      : '<span class="wc-chip busy"><i class="fa-solid fa-spinner"></i> Busy</span>';
    var assignmentLine = w.currentOrderId
      ? '<div class="wc-assignment"><i class="fa-solid fa-clipboard-list"></i> <span>Assigned to <strong>' + escHtml(w.currentOrderId) + '</strong>' + (w.currentPhase ? ' — ' + escHtml(w.currentPhase) : '') + '</span></div>'
      : '';
    var detailRole = roleCanEdit
      ? ('<div class="wc-actions">'
        + '<button class="wc-btn edit" data-edit="' + w.id + '"><i class="fa-solid fa-pen-to-square"></i> Edit</button>'
        + '<button class="wc-btn ' + (w.status === 'Active' ? 'toggle' : 'activate') + '" data-toggle="' + w.id + '">' + (w.status === 'Active' ? '<i class="fa-solid fa-power-off"></i> Deactivate' : '<i class="fa-solid fa-circle-check"></i> Activate') + '</button>'
        + '<button class="wc-btn delete" data-delete="' + w.id + '"><i class="fa-solid fa-trash-can"></i> Delete</button>'
        + '</div>')
      : '';

    return '<div class="worker-card">'
      + '<div class="wc-header">'
      +   '<div class="wc-avatar" style="background:linear-gradient(135deg,' + colorForName(w.name) + ',#0c2b6d);">' + escHtml(initials(w.name)) + '</div>'
      +   '<div class="wc-meta"><h4>' + escHtml(w.name) + '</h4><p>' + escHtml(w.phone || 'No phone') + ' · ' + escHtml(w.email || 'No email') + '</p></div>'
      +   '<span class="' + badgeClass + '">' + badgeText + '</span>'
      + '</div>'
      + '<div class="wc-body">'
      +   '<span class="wc-chip specialty"><i class="fa-solid fa-helmet-safety"></i> ' + escHtml(w.specialty) + '</span>'
      +   accountChip
      +   availableChip
      + '</div>'
      + assignmentLine
      + detailRole
      + '</div>';
  }).join('');

  grid.querySelectorAll('[data-edit]').forEach(function(b) {
    b.addEventListener('click', function() {
      var w = allWorkers.find(x => x.id === b.getAttribute('data-edit'));
      if (!w) return;
      document.getElementById('editWorkerId').value = w.id;
      document.getElementById('editName').value = w.name || '';
      document.getElementById('editPhone').value = w.phone || '';
      document.getElementById('editEmail').value = w.email || '';
      document.getElementById('editSpecialty').value = w.specialty || 'Builder';
      openWorkerModal('workerEditModal');
    });
  });
  grid.querySelectorAll('[data-toggle]').forEach(function(b) {
    b.addEventListener('click', function() {
      var w = allWorkers.find(x => x.id === b.getAttribute('data-toggle'));
      if (!w) return;
      if (w.status === 'Active') {
        if (!confirm('Deactivate ' + w.name + '? They will not receive new assignments and cannot log in until reactivated.')) return;
      } else {
        if (!confirm('Reactivate ' + w.name + '?')) return;
      }
      toggleWorkerActive(w.id, w.name);
    });
  });
  grid.querySelectorAll('[data-delete]').forEach(function(b) {
    b.addEventListener('click', function() {
      var w = allWorkers.find(x => x.id === b.getAttribute('data-delete'));
      if (!w) return;
      openDeleteModal(w);
    });
  });
}

async function toggleWorkerActive(id, name) {
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + '/workers/master/' + encodeURIComponent(id) + '/toggle-active', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }
    });
    var body = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw new Error(body.error || 'Toggle failed');
    showToast(name + ' ' + (body.status === 'Active' ? 'reactivated' : 'deactivated'), 'success');
    await loadWorkers();
  } catch (e) { alert(e.message); }
}

function openDeleteModal(w) {
  detailDeleteWorker = w;
  detailDeleteId = w.id;
  document.getElementById('deleteWorkerName').textContent = w.name;
  document.getElementById('deleteTypedName').value = '';
  document.getElementById('workerDeleteConfirmBtn').disabled = true;
  var blocked = w.currentOrderId ? '<strong>Currently assigned:</strong> ' + escHtml(w.orderPatientId || w.currentOrderId) + (w.currentPhase ? ' — ' + escHtml(w.currentPhase) : '') + '. Release the assignment before deleting.' : '';
  var warn = w.currentOrderId ? ('<div class="delete-order-warn"><i class="fa-solid fa-triangle-exclamation"></i> ' + escHtml(w.currentOrderId) + (w.currentPhase ? ' — ' + escHtml(w.currentPhase) : '') + '. This worker is actively assigned — release them first.</div>') : '';
  document.getElementById('deleteBlockedBox').innerHTML = warn;
  document.getElementById('deleteBlockedBox').style.display = warn ? 'block' : 'none';
  document.getElementById('deleteConfirmGroup').style.display = w.currentOrderId ? 'none' : 'block';
  document.getElementById('workerDeleteConfirmBtn').style.display = w.currentOrderId ? 'none' : 'inline-flex';
  document.getElementById('deleteModal').classList.add('show');
}

window.switchTab = function (tab) {
  document.querySelectorAll('.ww-tab').forEach(function(b) { b.classList.remove('active'); });
  var tabBtn = document.querySelector('.ww-tab[data-tab="' + tab + '"]');
  if (tabBtn) tabBtn.classList.add('active');
  document.getElementById('tabAll').style.display = tab === 'all' ? 'block' : 'none';
  document.getElementById('tabRegistrations').style.display = tab === 'registrations' ? 'block' : 'none';
};

/* ============ SEARCH / FILTER ============ */
function applyFilter() {
  var search = (document.getElementById('searchInput').value || '').toLowerCase();
  var s = document.getElementById('specialtyFilter').value;
  var f = document.getElementById('statusFilter').value;
  var filtered = allWorkers.filter(function(w) {
    if (s && (w.specialty || '').toLowerCase() !== s.toLowerCase()) return false;
    if (f === 'active' && w.status !== 'Active') return false;
    else if (f === 'inactive' && w.status === 'Active') return false;
    else if (f === 'busy' && w.available) return false;
    else if (f === 'available' && (!w.available || w.status !== 'Active')) return false;
    else if (f === 'linked' && !w.hasAccount) return false;
    else if (f === 'unlinked' && w.hasAccount) return false;
    if (!search) return true;
    return (w.name || '').toLowerCase().includes(search) ||
           (w.email || '').toLowerCase().includes(search) ||
           (w.phone || '').toLowerCase().includes(search) ||
           (w.specialty || '').toLowerCase().includes(search);
  });
  renderWorkers(filtered);
}
document.getElementById('searchInput')?.addEventListener('input', applyFilter);
document.getElementById('specialtyFilter')?.addEventListener('change', applyFilter);
document.getElementById('statusFilter')?.addEventListener('change', applyFilter);

/* ============ REGISTRATIONS ============ */
async function loadRegistrations() {
  var container = document.getElementById('registrationsGrid');
  container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading registrations...</p></div>';
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + '/worker-registrations', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    allRegistrations = await res.json();
    updateRegStats();
    renderRegistrations(allRegistrations);
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><p>Failed to load registrations</p></div>';
  }
}
function updateRegStats() {
  var pending = allRegistrations.filter(r => r.status === 'pending').length;
  var approved = allRegistrations.filter(r => r.status === 'approved').length;
  var rejected = allRegistrations.filter(r => r.status === 'rejected').length;
  document.getElementById('regPendingCount').textContent = pending;
  document.getElementById('regApprovedCount').textContent = approved;
  document.getElementById('regRejectedCount').textContent = rejected;
  var badge = document.getElementById('pendingBadge');
  if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline-block'; } else { badge.style.display = 'none'; }
}
function renderRegistrations(regs) {
  var container = document.getElementById('registrationsGrid');
  if (!regs.length) { container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><h3>No registrations yet</h3><p>Worker applications will appear here for your approval.</p></div>'; return; }
  var statusColors = { pending: '#b45309', approved: '#15803d', rejected: '#b91c1c' };
  var statusBg     = { pending: '#fef3c7', approved: '#dcfce7', rejected: '#fee2e2' };
  var statusLabel  = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };
  container.innerHTML = regs.map(function(r) {
    var actionsHtml = '';
    if (r.status === 'pending') {
      actionsHtml = '<div class="wc-actions"><button class="wc-btn activate" data-approve="' + r.id + '"><i class="fa-solid fa-check"></i> Approve</button>'
                  + '<button class="wc-btn delete" data-reject="' + r.id + '"><i class="fa-solid fa-xmark"></i> Reject</button></div>';
    } else {
      actionsHtml = '<div class="wc-actions"><button class="wc-btn edit" disabled style="opacity:.6;cursor:default;"><i class="fa-solid fa-circle-check"></i> ' + statusLabel[r.status] + '</button></div>';
    }
    return '<div class="worker-card">' +
      '<div class="wc-header">' +
        '<div class="wc-avatar" style="background:linear-gradient(135deg,' + colorForName(r.name) + ',#0c2b6d);">' + escHtml(initials(r.name)) + '</div>' +
        '<div class="wc-meta"><h4>' + escHtml(r.name) + '</h4><p>' + escHtml(r.email) + '</p></div>' +
        '<span class="wc-badge" style="background:' + statusBg[r.status] + ';color:' + statusColors[r.status] + ';">' + statusLabel[r.status] + '</span>' +
      '</div>' +
      '<div class="wc-body">' +
        '<span class="wc-chip specialty"><i class="fa-solid fa-helmet-safety"></i> ' + escHtml(r.specialty) + '</span>' +
        '<span class="wc-chip available"><i class="fa-solid fa-phone"></i> ' + escHtml(r.phone || 'No phone') + '</span>' +
      '</div>' +
      '<div class="wc-assignment"><i class="fa-solid fa-calendar"></i> <span><strong>Registered:</strong> ' + fmtDate(r.createdAt) + (r.reviewedAt ? ' · Reviewed ' + fmtDate(r.reviewedAt) : '') + '</span></div>' +
      actionsHtml + '</div>';
  }).join('');

  container.querySelectorAll('[data-approve]').forEach(function(b) {
    b.addEventListener('click', function() { approveReg(b.getAttribute('data-approve')); });
  });
  container.querySelectorAll('[data-reject]').forEach(function(b) {
    b.addEventListener('click', function() { rejectReg(b.getAttribute('data-reject')); });
  });
}
function applyRegFilter() {
  var q = (document.getElementById('regSearchInput').value || '').toLowerCase();
  var s = document.getElementById('regStatusFilter').value;
  var filtered = allRegistrations.filter(function(r) {
    if (s && r.status !== s) return false;
    if (!q) return true;
    return (r.name || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q);
  });
  renderRegistrations(filtered);
}
document.getElementById('regSearchInput')?.addEventListener('input', applyRegFilter);
document.getElementById('regStatusFilter')?.addEventListener('change', applyRegFilter);

async function approveReg(id) {
  if (!confirm('Approve this worker registration?')) return;
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + '/worker-registrations/' + id + '/approve', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
    });
    var body = await res.json();
    if (res.ok) { showToast('Worker approved', 'success'); await loadRegistrations(); await loadWorkers(); }
    else { alert(body.error || 'Approval failed'); }
  } catch (err) { alert('Connection error'); }
}
async function rejectReg(id) {
  var reason = prompt('Reason for rejection (optional):');
  if (reason === null) return;
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + '/worker-registrations/' + id + '/reject', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ reason: reason })
    });
    var body = await res.json();
    if (res.ok) { showToast('Registration rejected', 'info'); await loadRegistrations(); }
    else { alert(body.error || 'Reject failed'); }
  } catch (err) { alert('Connection error'); }
}
