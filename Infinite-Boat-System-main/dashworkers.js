/* =========================================
   WORKERS v2 — Minimal admin roster
   Manager view: no action buttons, clean profile read-only.
   ========================================= */
import { supabase, API_BASE } from "./supabase.js";
import { matchesQuery, flatText, queryFromUrl, setUrlQuery } from "./search-helpers.js?v=1";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

let allWorkers = [];
let allRegistrations = [];
let currentRole = 'admin';
let detailWorker = null;
let detailDeleteWorker = null;

function escHtml(s) {
  try { return window.escapeHtml ? window.escapeHtml(String(s ?? '')) : String(s ?? ''); } catch { return String(s ?? ''); }
}
function escAttr(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
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
  var h = 0; for (var i = 0; i < (name || '?').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  var palette = ['#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#4f46e5','#0d9488'];
  return palette[h % palette.length];
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
}

// ============ FORM VALIDATION ============
const EMAIL_RE = /^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^09\d{2}-?\d{3}-?\d{4}$/;

function normalizePhone(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length >= 11 && digits.startsWith('63')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}
function toStoredPhone(value) {
  var national = normalizePhone(value);
  return national ? '0' + national : '';
}
function isValidEmail(email) {
  email = String(email || '').trim();
  if (!email || email.length > 254) return false;
  var at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  var local = email.slice(0, at);
  var domain = email.slice(at + 1);
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (email.indexOf('..') !== -1) return false;
  return EMAIL_RE.test(email);
}
function getPasswordStrength(value) {
  var score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (value.length < 8 || score <= 1) return { level: 'weak', label: 'Weak' };
  if (score <= 3) return { level: 'fair', label: 'Fair' };
  return { level: 'strong', label: 'Strong' };
}
function getValue(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setFieldError(id, msg) {
  var el = document.getElementById(id + 'Error') || document.getElementById(id + 'Msg');
  if (el) { el.textContent = msg || ''; el.classList.toggle('show', !!msg); }
}
function validateRegName() {
  var v = getValue('regName');
  var msg = v === '' ? "Enter the worker's full name." : '';
  setFieldError('regName', msg);
  return !msg;
}
function validateRegEmail() {
  var v = getValue('regEmail');
  var msg = '';
  if (v === '') msg = 'Email address is required.';
  else if (!isValidEmail(v)) msg = 'Enter a valid email address (e.g. juan@example.com).';
  setFieldError('regEmail', msg);
  return !msg;
}
function validateRegPhone() {
  var v = getValue('regPhone');
  var national = normalizePhone(v);
  var msg = '';
  if (v === '') msg = 'Phone number is required.';
  else if (national === '' || !/^09\d{9}$/.test('0' + national)) msg = 'Enter a Philippine mobile number (e.g. 0917-123-4567).';
  setFieldError('regPhone', msg);
  return !msg;
}
function validateRegPassword() {
  var v = document.getElementById('regPassword').value;
  var msg = '';
  if (v.length === 0) msg = 'Password is required.';
  else if (v.length < 8) msg = 'Password must be at least 8 characters.';
  else if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) msg = 'Use letters and at least one number.';
  setFieldError('regPassword', msg);
  // strength meter
  var bar = document.getElementById('regStrength');
  var label = document.getElementById('regStrengthLabel');
  if (bar && label) {
    if (v === '') { bar.classList.remove('show'); label.textContent = ''; label.className = 'strength-label'; }
    else {
      var s = getPasswordStrength(v);
      bar.classList.add('show');
      var fill = bar.querySelector('.strength-fill');
      if (fill) fill.className = 'strength-fill ' + s.level;
      label.className = 'strength-label ' + s.level;
      label.textContent = 'Strength: ' + s.label;
    }
  }
  return !msg;
}
function validateRegConfirm() {
  var p = document.getElementById('regPassword').value;
  var c = document.getElementById('regConfirmPassword').value;
  var msg = c !== p ? 'Passwords do not match.' : '';
  setFieldError('regConfirmPassword', msg);
  return !msg;
}
function validateRegAll() {
  var ok = true;
  ok &= validateRegName();
  ok &= validateRegEmail();
  ok &= validateRegPhone();
  ok &= validateRegPassword();
  ok &= validateRegConfirm();
  return ok;
}
window.togglePassword = function(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  if (btn) {
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    var icon = btn.querySelector('i');
    if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  }
};

/* ============ AUTH + INIT ============ */
(async function init() {
  var auth = await window.requireRole(["admin", "manager"]);
  if (!auth) return;
  currentRole = auth.profile.role || 'admin';

  if (currentRole === 'manager') {
    document.getElementById('tabRegistrations').style.display = 'none';
    document.querySelector('.ww-tab[data-tab="registrations"]').style.display = 'none';
    document.getElementById('registerNewWorkerBtn').style.display = 'none';
  }

  await loadWorkers();
  if (isAdmin()) await loadRegistrations();

  wireButtons();
})();

function wireButtons() {
  ['regName','regEmail','regPhone','regPassword','regConfirmPassword'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var handlers = { regName:validateRegName, regEmail:validateRegEmail, regPhone:validateRegPhone, regPassword:validateRegPassword, regConfirmPassword:validateRegConfirm };
    el.addEventListener('input', handlers[id]);
    el.addEventListener('blur', handlers[id]);
  });
  var regBtn = document.getElementById('registerNewWorkerBtn');
  if (regBtn) regBtn.addEventListener('click', function() {
    if (!isAdmin()) return;
    document.getElementById('registerForm').reset();
    document.getElementById('regSpecialty').value = 'Builder';
    openWorkerModal('registerModal');
  });

  var regForm = document.getElementById('registerForm');
  if (regForm) regForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!isAdmin()) return;
    var btn = document.getElementById('regSubmitBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';
    try {
      var fullname = document.getElementById('regName').value.trim();
      var email = document.getElementById('regEmail').value.trim();
      var phone = toStoredPhone(document.getElementById('regPhone').value);
      var specialty = document.getElementById('regSpecialty').value;
      var password = document.getElementById('regPassword').value;
      var confirm = document.getElementById('regConfirmPassword').value;
      if (!validateRegAll()) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Register Worker'; return; }
      var token = await getToken();
      var res = await fetch(API_BASE + '/admin/create-worker', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ fullname, email, phone, specialty, password })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Unable to register worker');
      showToast('Worker registered — credentials emailed to ' + email, 'success');
      closeWorkerModal('registerModal');
      await loadWorkers();
      if (isAdmin()) await loadRegistrations();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Register Worker'; }
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
      // Refresh the profile modal with the updated record if open
      if (detailWorker) {
        var fresh = allWorkers.find(function(w) { return w.id === id; });
        if (fresh) openWorkerProfile(fresh);
      }
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }
  });

  // Delete modal typing check
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
      closeWorkerModal('workerViewModal');
      detailWorker = null;
      detailDeleteWorker = null;
      await loadWorkers();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete Forever'; }
  });

  // Profile modal admin action buttons
  document.getElementById('profileEditBtn')?.addEventListener('click', function() {
    if (!detailWorker) return;
    document.getElementById('editWorkerId').value = detailWorker.id;
    document.getElementById('editName').value = detailWorker.name || '';
    document.getElementById('editPhone').value = detailWorker.phone || '';
    document.getElementById('editEmail').value = detailWorker.email || '';
    document.getElementById('editSpecialty').value = detailWorker.specialty || 'Builder';
    openWorkerModal('workerEditModal');
  });
  document.getElementById('profileToggleBtn')?.addEventListener('click', async function() {
    if (!detailWorker) return;
    var w = detailWorker;
    var next = w.status === 'Active' ? 'Deactivate' : 'Reactivate';
    if (w.status === 'Active' && !confirm('Deactivate ' + w.name + '? They will not get new jobs and cannot log in until reactivated.')) return;
    if (w.status === 'Inactive' && !confirm('Reactivate ' + w.name + '? They will be available again.')) return;
    try {
      var token = await getToken();
      var res = await fetch(API_BASE + '/workers/master/' + encodeURIComponent(w.id) + '/toggle-active', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }
      });
      var body = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(body.error || 'Toggle failed');
      showToast(w.name + ' ' + (body.status === 'Active' ? 'reactivated' : 'deactivated'), 'success');
      await loadWorkers();
    } catch (err) { alert(err.message); }
  });
  document.getElementById('profileDeleteBtn')?.addEventListener('click', function() {
    if (!detailWorker) return;
    openDeleteModal(detailWorker);
  });
}

/* ============ MODAL HELPERS ============ */
window.openWorkerModal = function(id) { document.getElementById(id).classList.add('show'); };
window.closeWorkerModal = function(id) { document.getElementById(id).classList.remove('show'); };

function openDeleteModal(w) {
  detailDeleteWorker = w;
  document.getElementById('deleteWorkerName').textContent = w.name;
  document.getElementById('deleteTypedName').value = '';
  document.getElementById('workerDeleteConfirmBtn').disabled = true;
  var blocked = w.currentOrderId ? '<strong>Currently assigned:</strong> ' + escHtml(w.currentOrderId) + ' — ' + escHtml(w.currentPhase || '—') + '. Release the assignment before deleting.' : '';
  document.getElementById('deleteBlockedBox').innerHTML = blocked
    ? '<div><i class="fa-solid fa-triangle-exclamation"></i> <strong>Blocked:</strong> ' + blocked + '</div>'
    : '';
  document.getElementById('deleteBlockedBox').style.display = blocked ? 'block' : 'none';
  document.getElementById('deleteConfirmGroup').style.display = blocked ? 'none' : 'block';
  document.getElementById('workerDeleteConfirmBtn').style.display = blocked ? 'none' : 'inline-flex';
  document.getElementById('deleteModal').classList.add('show');
}

/* ============ LOAD + RENDER ============ */
async function loadWorkers() {
  var tableBody = document.getElementById("workersTableBody");
  tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px 10px;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;"></i></td></tr>';
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + "/admin/workers-detail", { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    allWorkers = await res.json();
    renderStats();
    applyFilter();
  } catch (e) {
    document.getElementById("workersTableBody").innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#dc2626;">Failed to load workers</td></tr>';
  }
}

function renderStats() {
  document.getElementById("statTotal").textContent = allWorkers.length;
  document.getElementById("statActive").textContent = allWorkers.filter(w => w.status === "Active").length;
  document.getElementById("statBusy").textContent = allWorkers.filter(w => !w.available).length;
  document.getElementById("statAvailable").textContent = allWorkers.filter(w => w.available && w.status === "Active").length;
}

function updateCount(id, shown, total, query) {
  var count = document.getElementById(id);
  if (!count) return;
  count.textContent = !total ? 'No records'
    : query ? shown + ' of ' + total + ' shown'
    : total + ' records';
  count.classList.toggle('is-empty', total > 0 && shown === 0);
}

function applyFilter() {
  var search = (document.getElementById('searchInput').value || '').trim();
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
    return matchesQuery(flatText(
      w.name, w.email, w.phone, w.specialty, w.role, w.status,
      w.available ? 'Available Ready' : 'Busy'
    ), search);
  });
  renderTable(filtered);
  updateCount('workerResultCount', filtered.length, allWorkers.length, search);
}

function renderTable(workers) {
  var tbody = document.getElementById("workersTableBody");
  var empty = document.getElementById("workersEmpty");
  if (!workers.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = workers.map(function(w) {
    return '<tr>'
      + '<td data-label="Worker">'
      +   '<div class="worker-cell">'
      +     '<div class="worker-avatar" style="background:linear-gradient(135deg,' + colorForName(w.name) + ',#0c2b6d);">' + escHtml(initials(w.name)) + '</div>'
      +     '<div class="worker-meta"><h4>' + escHtml(w.name) + '</h4><p>' + escHtml(w.email || (w.phone ? w.phone : 'No contact')) + '</p></div>'
      +   '</div>'
      + '</td>'
      + '<td data-label="Specialty"><span class="specialty-tag">' + escHtml(w.specialty) + '</span></td>'
      + '<td data-label="Phone">' + escHtml(w.phone || '—') + '</td>'
      + '<td data-label="Status"><span class="status-pill ' + (w.status === 'Active' ? 'active' : 'inactive') + '">' + (w.status === 'Active' ? 'Active' : 'Deactivated') + '</span></td>'
      + '<td data-label="Availability"><span class="avail-tag ' + (w.available ? 'available' : 'busy') + '">' + (w.available ? 'Ready' : 'Busy') + '</span></td>'
      + '<td class="col-actions" data-label="Action"><button class="view-btn" data-view="' + w.id + '">View</button></td>'
      + '</tr>';
  }).join('');
  tbody.querySelectorAll('[data-view]').forEach(function(b) {
    b.addEventListener('click', function() {
      var w = allWorkers.find(x => x.id === b.getAttribute('data-view'));
      if (w) openWorkerProfile(w);
    });
  });
}

document.getElementById('searchInput')?.addEventListener('input', function () {
  setUrlQuery(this.value.trim());
  applyFilter();
});
document.getElementById('specialtyFilter')?.addEventListener('change', applyFilter);
document.getElementById('statusFilter')?.addEventListener('change', applyFilter);

var initialWorkerQuery = queryFromUrl().trim();
if (initialWorkerQuery) {
  var initialWorkerInput = document.getElementById('searchInput');
  if (initialWorkerInput) initialWorkerInput.value = initialWorkerQuery;
}

function openWorkerProfile(w) {
  detailWorker = w;
  document.getElementById('profileAvatar').textContent = initials(w.name);
  document.getElementById('profileAvatar').style.background = 'linear-gradient(135deg,' + colorForName(w.name) + ',#0c2b6d)';
  document.getElementById('profileName').textContent = w.name;
  document.getElementById('profileSpecialty').textContent = w.specialty;
  document.getElementById('profileSpecialty2').textContent = w.specialty;
  document.getElementById('profilePhone').textContent = w.phone || '—';
  document.getElementById('profileEmail').textContent = w.email || '—';
  document.getElementById('profileStatus').textContent = w.status === 'Active' ? 'Active' : 'Deactivated';
  document.getElementById('profileAccount').textContent = w.hasAccount ? 'Linked Account' : 'Roster Only';
  document.getElementById('profileAvail').textContent = w.available ? 'Ready' : 'Busy';
  document.getElementById('profileJoined').textContent = fmtDate(w.createdAt);
  document.getElementById('profileStatusBadge').className = 'badge-' + (w.status === 'Active' ? 'active' : 'red');
  document.getElementById('profileStatusBadge').textContent = w.status === 'Active' ? 'Active' : 'Deactivated';
  document.getElementById('profileAccountBadge').className = 'badge-' + (w.hasAccount ? 'blue' : 'neutral');
  document.getElementById('profileAccountBadge').textContent = w.hasAccount ? 'Account' : 'Roster';
  document.getElementById('profileAvailBadge').className = 'badge-' + (w.available ? 'blue' : 'amber');
  document.getElementById('profileAvailBadge').textContent = w.available ? 'Available' : 'Busy';
  document.getElementById('profileChip').style.display = 'none';
  var assignBox = document.getElementById('profileAssignment');
  if (w.currentOrderId) {
    assignBox.innerHTML = '<div class="assignment-banner"><i class="fa-solid fa-person-digging"></i><div><strong>ORD-' + escHtml((w.currentOrderId || '').replace(/^ORD-?/i, '')) + '</strong> — ' + escHtml(w.currentPhase || 'assigned') + '</div></div>';
    assignBox.classList.remove('profile-empty');
  } else {
    assignBox.innerHTML = '<div class="avail-banner"><i class="fa-solid fa-circle-check"></i><span><strong>Available</strong> — no active assignment right now.</span></div>';
    assignBox.classList.remove('profile-empty');
  }
  // Admin-only actions
  var adminActions = document.getElementById('profileAdminActions');
  var mgrNote = document.getElementById('profileManagerNote');
  if (isAdmin()) {
    adminActions.style.display = 'grid';
    mgrNote.style.display = 'none';
    document.getElementById('profileToggleBtn').innerHTML = w.status === 'Active'
      ? '<i class="fa-solid fa-power-off"></i> Deactivate'
      : '<i class="fa-solid fa-circle-check"></i> Activate';
    document.getElementById('profileToggleBtn').className = 'qa-btn ' + (w.status === 'Active' ? 'ghost' : 'ghost');
  } else {
    adminActions.style.display = 'none';
    mgrNote.style.display = 'inline-flex';
  }
  document.getElementById('workerViewModal').classList.add('show');
}

/* ============ REGISTRATIONS ============ */
async function loadRegistrations() {
  var grid = document.getElementById('registrationsGrid');
  grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading registrations...</p></div>';
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + '/worker-registrations', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    allRegistrations = await res.json();
    updateRegStats();
    applyRegFilter();
  } catch (err) {
    grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><h3>Failed to load registrations</h3><p>Try refreshing the page.</p></div>';
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
  var grid = document.getElementById('registrationsGrid');
  if (!regs.length) { grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><h3>No registrations yet</h3><p>Worker applications will appear here for your approval.</p></div>'; return; }
  var statusColors = { pending: '#b45309', approved: '#15803d', rejected: '#b91c1c' };
  var statusBg     = { pending: '#fef3c7', approved: '#dcfce7', rejected: '#fee2e2' };
  var statusLabel  = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };
  grid.innerHTML = regs.map(function(r) {
    var actionsHtml = '';
    if (r.status === 'pending') {
      actionsHtml = '<div class="reg-actions">'
        + '<button class="reg-btn approve" data-approve="' + r.id + '"><i class="fa-solid fa-check"></i> Approve</button>'
        + '<button class="reg-btn reject" data-reject="' + r.id + '"><i class="fa-solid fa-xmark"></i> Reject</button>'
        + '</div>';
    } else {
      actionsHtml = '<div class="reg-actions"><button class="reg-btn" disabled style="background:#e2e8f0;color:#94a3b8;cursor:default;"><i class="fa-solid fa-circle-check"></i> ' + statusLabel[r.status] + '</button></div>';
    }
    return '<div class="reg-card">'
      +   '<div class="reg-card-header">'
      +     '<div class="reg-avatar" style="background:linear-gradient(135deg,' + colorForName(r.name) + ',#0c2b6d);">' + escHtml(initials(r.name)) + '</div>'
      +     '<div class="reg-meta"><h4>' + escHtml(r.name) + '</h4><p>' + escHtml(r.email || '—') + '</p></div>'
      +     '<span class="status-pill ' + (r.status === 'pending' ? 'active' : (r.status === 'approved' ? 'completed' : 'inactive')) + '">' + statusLabel[r.status] + '</span>'
      +   '</div>'
      +   '<div class="reg-row">'
      +     '<span class="reg-chip"><i class="fa-solid fa-helmet-safety"></i> ' + escHtml(r.specialty || '—') + '</span>'
      +     '<span class="reg-chipPhone"><i class="fa-solid fa-phone"></i> ' + escHtml(r.phone || '—') + '</span>'
      +   '</div>'
      +   '<div class="list-card-sub"><i class="fa-solid fa-calendar"></i> Registered: ' + fmtDate(r.createdAt) + (r.reviewedAt ? ' · Reviewed ' + fmtDate(r.reviewedAt) : '') + '</div>'
      +   actionsHtml
      + '</div>';
  }).join('');
  grid.querySelectorAll('[data-approve]').forEach(function(b) { b.addEventListener('click', function() { approveReg(b.getAttribute('data-approve')); }); });
  grid.querySelectorAll('[data-reject]').forEach(function(b) { b.addEventListener('click', function() { rejectReg(b.getAttribute('data-reject')); }); });
}
function applyRegFilter() {
  var q = (document.getElementById('regSearchInput').value || '').trim();
  var s = document.getElementById('regStatusFilter').value;
  var filtered = allRegistrations.filter(function(r) {
    if (s && r.status !== s) return false;
    if (!q) return true;
    return matchesQuery(flatText(r.name, r.email, r.phone, r.specialty, r.status, r.createdAt, r.reviewedAt), q);
  });
  renderRegistrations(filtered);
  updateCount('regResultCount', filtered.length, allRegistrations.length, q);
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
      body: JSON.stringify({ reason })
    });
    var body = await res.json();
    if (res.ok) { showToast('Registration rejected', 'info'); await loadRegistrations(); }
    else { alert(body.error || 'Reject failed'); }
  } catch (err) { alert('Connection error'); }
}

/* ============ TABS ============ */
window.switchTab = function (tab) {
  document.querySelectorAll('.ww-tab').forEach(function(b) { b.classList.remove('active'); });
  var tabBtn = document.querySelector('.ww-tab[data-tab="' + tab + '"]');
  if (tabBtn) tabBtn.classList.add('active');
  document.getElementById('tabAll').style.display = tab === 'all' ? 'block' : 'none';
  document.getElementById('tabRegistrations').style.display = tab === 'registrations' ? 'block' : 'none';
};
