import { supabase, API_BASE } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

let allWorkers = [];
let allRegistrations = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (!profile || profile.role !== "admin") { window.location.href = "login.html"; return; }

  await loadWorkers();
  await loadRegistrations();
}

function getToken() {
  return supabase.auth.getSession().then(s => s.data.session?.access_token);
}

/* ======= TABS ======= */
window.switchTab = function (tab) {
  document.querySelectorAll('.ww-tab').forEach(function(b) {
    b.classList.remove('active');
  });
  document.querySelector('.ww-tab[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('tabAll').style.display = tab === 'all' ? 'block' : 'none';
  document.getElementById('tabRegistrations').style.display = tab === 'registrations' ? 'block' : 'none';
};

/* ======= WORKERS ======= */
async function loadWorkers() {
  const container = document.getElementById("workersGrid");
  container.innerHTML = '<div class="worker-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading workers...</div>';

  try {
    const token = await getToken();
    const res = await fetch(API_BASE + "/admin/workers-detail", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) throw new Error("Failed to load");
    allWorkers = await res.json();
    updateStats();
    renderWorkers(allWorkers);
  } catch (err) {
    container.innerHTML = '<div class="worker-empty"><i class="fa-solid fa-circle-exclamation"></i><p>Failed to load workers</p></div>';
  }
}

function updateStats() {
  document.getElementById("statTotal").textContent = allWorkers.length;
  document.getElementById("statLinked").textContent = allWorkers.filter(w => w.hasAccount).length;
  document.getElementById("statActive").textContent = allWorkers.filter(w => w.status === "Active").length;
  document.getElementById("statBusy").textContent = allWorkers.filter(w => !w.available).length;
}

function renderWorkers(workers) {
  const container = document.getElementById("workersGrid");

  if (!workers.length) {
    container.innerHTML = '<div class="worker-empty"><i class="fa-solid fa-users"></i><p>No workers found</p></div>';
    return;
  }

  container.innerHTML = workers.map(function(w) {
    var statusColor = w.status === "Active" ? "#22c55e" : "#ef4444";
    var statusBg = w.status === "Active" ? "#dcfce7" : "#fee2e2";
    var statusText = w.status === "Active" ? "Active" : "Inactive";

    var accountBadge = w.hasAccount
      ? '<span class="worker-tag" style="background:#dcfce7;color:#16a34a;"><i class="fa-solid fa-link"></i> Linked</span>'
      : '<span class="worker-tag" style="background:#fef3c7;color:#d97706;"><i class="fa-solid fa-unlink"></i> No Account</span>';

    var availabilityBadge = w.available
      ? '<span class="worker-tag" style="background:#dbeafe;color:#2563eb;"><i class="fa-solid fa-clock"></i> Available</span>'
      : '<span class="worker-tag" style="background:#fef3c7;color:#d97706;"><i class="fa-solid fa-spinner"></i> Busy</span>';

    var assignmentHtml = w.currentOrderId
      ? '<div class="worker-card-assignment"><strong><i class="fa-solid fa-clipboard-list"></i> Assigned:</strong> ' + escHtml(w.currentOrderId) + (w.currentPhase ? ' — ' + escHtml(w.currentPhase) : '') + '</div>'
      : '';

    return '<div class="worker-card">' +
      '<div class="worker-card-header">' +
        '<div>' +
          '<div class="worker-card-name">' + escHtml(w.name) + '</div>' +
          '<div class="worker-card-email">' + escHtml(w.email || 'No email') + '</div>' +
        '</div>' +
        '<span class="worker-badge" style="background:' + statusBg + ';color:' + statusColor + ';">' + statusText + '</span>' +
      '</div>' +
      '<div class="worker-card-details">' +
        '<div class="worker-detail-row"><i class="fa-solid fa-helmet-safety"></i> ' + escHtml(w.specialty) + '</div>' +
        '<div class="worker-detail-row"><i class="fa-solid fa-phone"></i> ' + escHtml(w.phone || 'N/A') + '</div>' +
        '<div class="worker-detail-row">' + accountBadge + ' ' + availabilityBadge + '</div>' +
      '</div>' +
      assignmentHtml +
    '</div>';
  }).join('');
}

window.filterWorkers = function () {
  var search = document.getElementById("searchInput").value.toLowerCase();
  var specialtyFilter = document.getElementById("specialtyFilter").value;
  var statusFilter = document.getElementById("statusFilter").value;

  var filtered = allWorkers;

  if (search) {
    filtered = filtered.filter(function(w) {
      return (w.name || "").toLowerCase().includes(search) ||
             (w.email || "").toLowerCase().includes(search) ||
             (w.phone || "").toLowerCase().includes(search);
    });
  }

  if (specialtyFilter) {
    filtered = filtered.filter(function(w) {
      return (w.specialty || "").toLowerCase() === specialtyFilter.toLowerCase();
    });
  }

  if (statusFilter === "active") filtered = filtered.filter(function(w) { return w.status === "Active"; });
  else if (statusFilter === "inactive") filtered = filtered.filter(function(w) { return w.status !== "Active"; });
  else if (statusFilter === "linked") filtered = filtered.filter(function(w) { return w.hasAccount; });
  else if (statusFilter === "unlinked") filtered = filtered.filter(function(w) { return !w.hasAccount; });
  else if (statusFilter === "busy") filtered = filtered.filter(function(w) { return !w.available; });
  else if (statusFilter === "available") filtered = filtered.filter(function(w) { return w.available; });

  renderWorkers(filtered);
};

document.getElementById("searchInput")?.addEventListener("input", filterWorkers);
document.getElementById("specialtyFilter")?.addEventListener("change", filterWorkers);
document.getElementById("statusFilter")?.addEventListener("change", filterWorkers);

/* ======= REGISTRATIONS ======= */
async function loadRegistrations() {
  var container = document.getElementById("registrationsGrid");
  container.innerHTML = '<div class="worker-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading registrations...</div>';

  try {
    var token = await getToken();
    var res = await fetch(API_BASE + "/worker-registrations", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) throw new Error("Failed to load");
    allRegistrations = await res.json();
    updateRegStats();
    renderRegistrations(allRegistrations);
  } catch (err) {
    container.innerHTML = '<div class="worker-empty"><i class="fa-solid fa-circle-exclamation"></i><p>Failed to load registrations</p></div>';
  }
}

function updateRegStats() {
  var pending = allRegistrations.filter(function(r) { return r.status === "pending"; }).length;
  var approved = allRegistrations.filter(function(r) { return r.status === "approved"; }).length;
  var rejected = allRegistrations.filter(function(r) { return r.status === "rejected"; }).length;

  document.getElementById("regPendingCount").textContent = pending;
  document.getElementById("regApprovedCount").textContent = approved;
  document.getElementById("regRejectedCount").textContent = rejected;

  var badge = document.getElementById("pendingBadge");
  if (pending > 0) {
    badge.textContent = pending;
    badge.style.display = "inline";
  } else {
    badge.style.display = "none";
  }
}

function renderRegistrations(regs) {
  var container = document.getElementById("registrationsGrid");

  if (!regs.length) {
    container.innerHTML = '<div class="worker-empty"><i class="fa-solid fa-clipboard-list"></i><p>No registrations yet</p></div>';
    return;
  }

  var statusColors = { pending: '#f59e0b', approved: '#22c55e', rejected: '#ef4444' };
  var statusBg = { pending: '#fef3c7', approved: '#dcfce7', rejected: '#fee2e2' };

  container.innerHTML = regs.map(function(r) {
    var actionsHtml = '';
    if (r.status === 'pending') {
      actionsHtml = '<div class="ww-reg-card-actions">' +
        '<button onclick="approveRegistration(\'' + r.id + '\')" style="background:#22c55e;"><i class="fa-solid fa-check"></i> Approve</button>' +
        '<button onclick="rejectRegistration(\'' + r.id + '\')" style="background:#ef4444;"><i class="fa-solid fa-xmark"></i> Reject</button>' +
      '</div>';
    } else if (r.status === 'approved') {
      actionsHtml = '<div class="ww-reg-card-actions">' +
        '<button disabled style="background:#e2e8f0;color:#94a3b8;cursor:default;"><i class="fa-solid fa-check-circle"></i> Approved</button>' +
      '</div>';
    } else {
      actionsHtml = '<div class="ww-reg-card-actions">' +
        '<button disabled style="background:#e2e8f0;color:#94a3b8;cursor:default;"><i class="fa-solid fa-ban"></i> Rejected</button>' +
      '</div>';
    }

    var reviewedHtml = '';
    if (r.reviewedAt) {
      reviewedHtml = '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">Reviewed: ' + new Date(r.reviewedAt).toLocaleDateString() + '</div>';
    }

    return '<div class="ww-reg-card">' +
      '<div class="ww-reg-card-header">' +
        '<div>' +
          '<div class="ww-reg-card-name">' + escHtml(r.name) + '</div>' +
          '<div class="ww-reg-card-email">' + escHtml(r.email) + '</div>' +
        '</div>' +
        '<span class="worker-badge" style="background:' + statusBg[r.status] + ';color:' + statusColors[r.status] + ';">' + r.status.charAt(0).toUpperCase() + r.status.slice(1) + '</span>' +
      '</div>' +
      '<div class="ww-reg-card-details">' +
        '<div class="worker-detail-row"><i class="fa-solid fa-helmet-safety"></i> ' + escHtml(r.specialty) + '</div>' +
        '<div class="worker-detail-row"><i class="fa-solid fa-phone"></i> ' + escHtml(r.phone || 'N/A') + '</div>' +
      '</div>' +
      '<div class="ww-reg-date"><i class="fa-solid fa-calendar"></i> Registered: ' + new Date(r.createdAt).toLocaleDateString() + '</div>' +
      reviewedHtml +
      actionsHtml +
    '</div>';
  }).join('');
}

window.filterRegistrations = function () {
  var search = document.getElementById("regSearchInput").value.toLowerCase();
  var statusFilter = document.getElementById("regStatusFilter").value;

  var filtered = allRegistrations;

  if (search) {
    filtered = filtered.filter(function(r) {
      return (r.name || "").toLowerCase().includes(search) ||
             (r.email || "").toLowerCase().includes(search);
    });
  }

  if (statusFilter) {
    filtered = filtered.filter(function(r) { return r.status === statusFilter; });
  }

  renderRegistrations(filtered);
};

document.getElementById("regSearchInput")?.addEventListener("input", filterRegistrations);
document.getElementById("regStatusFilter")?.addEventListener("change", filterRegistrations);

/* ======= APPROVE / REJECT ======= */
window.approveRegistration = async function (id) {
  if (!confirm("Approve this worker registration?")) return;
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + "/worker-registrations/" + id + "/approve", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }
    });
    var result = await res.json();
    if (res.ok) {
      alert("Worker registered and approved!");
      await loadRegistrations();
      await loadWorkers();
    } else {
      alert(result.error || "Failed to approve");
    }
  } catch (err) {
    alert("Connection error");
  }
};

window.rejectRegistration = async function (id) {
  var reason = prompt("Reason for rejection (optional):");
  if (reason === null) return;
  try {
    var token = await getToken();
    var res = await fetch(API_BASE + "/worker-registrations/" + id + "/reject", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ reason: reason })
    });
    var result = await res.json();
    if (res.ok) {
      alert("Registration rejected.");
      await loadRegistrations();
    } else {
      alert(result.error || "Failed to reject");
    }
  } catch (err) {
    alert("Connection error");
  }
};

/* ======= REGISTER NEW WORKER ======= */
window.openRegisterModal = function () {
  document.getElementById("registerModal").style.display = "flex";
  document.getElementById("registerForm").reset();
};

window.closeRegisterModal = function () {
  document.getElementById("registerModal").style.display = "none";
};

window.submitRegisterWorker = async function (e) {
  e.preventDefault();

  var name = document.getElementById("regName").value.trim();
  var email = document.getElementById("regEmail").value.trim();
  var phone = document.getElementById("regPhone").value.trim();
  var specialty = document.getElementById("regSpecialty").value;
  var password = document.getElementById("regPassword").value;
  var confirmPassword = document.getElementById("regConfirmPassword").value;

  if (!name || !email || !specialty || !password) {
    alert("Please fill in all required fields.");
    return;
  }

  if (password.length < 8) {
    alert("Password must be at least 8 characters.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  var btn = document.getElementById("regSubmitBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';

  try {
    var token = await getToken();
    var res = await fetch(API_BASE + "/admin/create-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ fullname: name, email, phone, specialty, password })
    });
    var result = await res.json();
    if (res.ok) {
      alert("Worker account created successfully! Credentials sent to " + email);
      closeRegisterModal();
      await loadWorkers();
      await loadRegistrations();
    } else {
      alert(result.error || "Failed to create worker account");
    }
  } catch (err) {
    alert("Connection error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Register Worker';
  }
};

/* ======= HELPERS ======= */
function escHtml(s) {
  var d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
