import { supabase, API_BASE, showToast, notifySound } from "./supabase.js";
import { MILESTONE_KEY_LABELS } from "./boatData.js";

const SPECIALTY_ICONS = {
  engineer: "fa-user-gear",
  builder: "fa-hard-hat",
  welder: "fa-wrench",
  electrician: "fa-bolt",
  painter: "fa-paint-roller",
  "fiberglass specialist": "fa-fill-drip",
};

function getSpecialtyClass(role) {
  return (role || "").toLowerCase().replace(/\s+/g, "-");
}

function getSpecialtyIcon(role) {
  const key = (role || "").toLowerCase();
  for (const [k, icon] of Object.entries(SPECIALTY_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return "fa-user";
}

function getPhaseLabel(key) {
  return MILESTONE_KEY_LABELS[key] || key || "";
}

const userId = localStorage.getItem("userId");
const role = localStorage.getItem("role");

if (!userId || role !== "worker") {
  window.location.href = "login.html";
}

let currentPage = new URLSearchParams(window.location.search).get("page") || "assignments";
let assignments = [];
let workerProfile = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (!userId) { window.location.href = "login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profile || profile.role !== "worker") {
    window.location.href = "login.html";
    return;
  }

  workerProfile = profile;
  document.getElementById("workerName").textContent = profile.name || "Worker";
  document.getElementById("profileName").textContent = profile.name;
  document.getElementById("profileEmail").textContent = profile.email;
  document.getElementById("editName").value = profile.name || "";
  document.getElementById("editPhone").value = profile.phone || "";

  const { data: worker } = await supabase
    .from("workers")
    .select("specialty, status")
    .eq("userId", userId)
    .maybeSingle();

  if (worker) {
    document.getElementById("profileSpecialty").textContent = worker.specialty;
    document.getElementById("profilePic").src = profile.photo || "./images/user.png";
  }

  await loadAssignments();
  await loadNotifications();
  setupNotifBell();
  navigateTo(currentPage);

  document.getElementById("workerMarkAllRead").addEventListener("click", markAllRead);
}

async function loadAssignments() {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(API_BASE + "/worker/my-assignments", {
      headers: { Authorization: "Bearer " + token }
    });
    assignments = await res.json();
    updateStats();
    renderAssignments();
  } catch (err) {
    console.error("Failed to load assignments:", err);
  }
}

function updateStats() {
  const total = assignments.length;
  const active = assignments.filter(a => a.status === "Active").length;
  const completed = assignments.filter(a => a.status === "Completed").length;

  document.getElementById("totalAssignments").textContent = total;
  document.getElementById("activeAssignments").textContent = active;
  document.getElementById("completedAssignments").textContent = completed;

  const badge = document.getElementById("availabilityBadge");
  const text = document.getElementById("availabilityText");
  if (active > 0) {
    badge.classList.add("busy");
    text.textContent = "Busy";
  } else {
    badge.classList.remove("busy");
    text.textContent = "Available";
  }
}

function renderAssignments() {
  const container = document.getElementById("assignmentsList");
  const filtered = currentPage === "assignments"
    ? assignments
    : assignments.filter(a => {
        if (currentPage === "active") return a.status === "Active";
        if (currentPage === "completed") return a.status === "Completed";
        return true;
      });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clipboard-list"></i>
        <p>No assignments yet</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(a => {
    const order = a.boat_orders || {};
    return `
      <div class="assignment-card" onclick="viewProject('${a.id}', '${a.orderId}')">
        <div class="card-header">
          <div>
            <h3>${escHtml(order.boatName || a.orderId)}</h3>
            <div class="order-id">${escHtml(a.orderId)}</div>
          </div>
          <span class="status-badge ${a.status.toLowerCase()}">${a.status}</span>
        </div>
        <div class="card-body">
          <div class="detail-row">
            <span class="detail-label">Phase</span>
            <span class="phase-badge">${escHtml(a.phase || "N/A")}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Progress</span>
            <span class="detail-value">${order.progress || 0}%</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Order Status</span>
            <span class="detail-value">${escHtml(order.status || "N/A")}</span>
          </div>
          ${a.startDate ? `<div class="detail-row"><span class="detail-label">Started</span><span class="detail-value">${formatDate(a.startDate)}</span></div>` : ""}
        </div>
        <div class="card-footer">
          <button class="action-btn btn-view" onclick="event.stopPropagation(); viewProject('${a.id}', '${a.orderId}')">View Details</button>
          ${a.status === "Active" ? `
            <button class="action-btn btn-progress" onclick="event.stopPropagation(); markInProgress('${a.id}')">In Progress</button>
            <button class="action-btn btn-complete" onclick="event.stopPropagation(); markComplete('${a.id}')">Complete</button>
          ` : ""}
        </div>
      </div>`;
  }).join("");
}

window.markInProgress = async function (id) {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(API_BASE + `/worker/update-task/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ status: "Active" })
    });
    if (res.ok) {
      showToast("Task marked as In Progress", "success");
      await loadAssignments();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to update", "error");
    }
  } catch (err) {
    showToast("Connection error", "error");
  }
};

window.markComplete = async function (id) {
  if (!confirm("Mark this task as completed?")) return;
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(API_BASE + `/worker/update-task/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ status: "Completed" })
    });
    if (res.ok) {
      showToast("Task completed!", "success");
      await loadAssignments();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to update", "error");
    }
  } catch (err) {
    showToast("Connection error", "error");
  }
};

window.viewProject = async function (assignmentId, orderId) {
  const assignment = assignments.find(a => a.id === assignmentId);
  if (!assignment) return;

  const order = assignment.boat_orders || {};

  let milestonesHtml = "";
  try {
    const { data: fullOrder } = await supabase
      .from("boat_orders")
      .select("milestones, progress")
      .eq("orderId", orderId)
      .maybeSingle();

    if (fullOrder?.milestones?.length) {
      milestonesHtml = `<div class="detail-section">
        <h4>Milestones</h4>
        <ul class="milestone-list">
          ${fullOrder.milestones.map(m => `
            <li>
              <span class="milestone-check ${m.completed ? 'done' : 'pending'}">
                <i class="fa-solid ${m.completed ? 'fa-check' : 'fa-circle'}"></i>
              </span>
              ${escHtml(m.label || m.key || "Milestone")} — ${m.completed ? "Done" : `${fullOrder.progress || 0}%`}
            </li>`).join("")}
        </ul>
      </div>`;
    }
  } catch (e) { /* skip */ }

  let workersHtml = "";
  try {
    const { data: workers } = await supabase
      .from("project_workers")
      .select("name, specialty, role, phase, status")
      .eq("orderId", orderId);

    if (workers?.length) {
      const isEngineer = w => (w.role || w.specialty || "").toLowerCase() === "engineer";
      const engineers = workers.filter(isEngineer);
      const others = workers.filter(w => !isEngineer(w));
      const sorted = [...engineers, ...others];

      workersHtml = `<div class="detail-section">
        <h4>Workers Assigned</h4>
        <div class="workers-full-list">
          ${sorted.map(w => {
            const sClass = getSpecialtyClass(w.role || w.specialty);
            const specialty = w.specialty || w.role || "";
            const phaseLabel = getPhaseLabel(w.phase);
            const isActive = w.status === "Active";
            const isMe = w.name === assignment.name;
            const isEng = isEngineer(w);
            return `<div class="worker-item ${isEng ? 'role-engineer' : 'role-' + sClass} ${isMe ? 'is-me' : ''}">
              <div class="worker-avatar"><i class="fa-solid ${getSpecialtyIcon(specialty)}"></i></div>
              <div class="worker-info">
                <h5>${escHtml(w.name)} ${isMe ? '<span class="is-me-badge">You</span>' : ''} ${isEng ? '<span class="engineer-badge">ENGINEER</span>' : ''}</h5>
                <span class="worker-role-label">${escHtml(specialty)}</span>
                ${phaseLabel ? `<span class="worker-phase-label">${escHtml(phaseLabel)}</span>` : ""}
                <span class="worker-phase-label ${isActive ? 'status-on' : 'status-off'}">${isActive ? "Working" : "Completed"}</span>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    }
  } catch (e) { /* skip */ }

  const body = document.getElementById("modalBody");
  body.innerHTML = `
    <div class="detail-section">
      <h4>Project Info</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Order ID</label><span>${escHtml(orderId)}</span></div>
        <div class="detail-item"><label>Boat</label><span>${escHtml(order.boatName || "N/A")}</span></div>
        <div class="detail-item"><label>Price</label><span>${escHtml(order.boatPrice || "N/A")}</span></div>
        <div class="detail-item"><label>Status</label><span>${escHtml(order.status || "N/A")}</span></div>
        <div class="detail-item"><label>Progress</label><span>${order.progress || 0}%</span></div>
        <div class="detail-item"><label>Phase</label><span>${escHtml(order.orderPhase || assignment.phase || "N/A")}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Your Assignment</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Phase</label><span>${escHtml(assignment.phase || "N/A")}</span></div>
        <div class="detail-item"><label>Status</label><span>${escHtml(assignment.status)}</span></div>
        <div class="detail-item"><label>Specialty</label><span>${escHtml(assignment.specialty || assignment.role || "N/A")}</span></div>
        ${assignment.startDate ? `<div class="detail-item"><label>Start Date</label><span>${formatDate(assignment.startDate)}</span></div>` : ""}
        ${assignment.completedAt ? `<div class="detail-item"><label>Completed</label><span>${formatDate(assignment.completedAt)}</span></div>` : ""}
      </div>
    </div>
    ${milestonesHtml}
    ${workersHtml}
    ${assignment.status === "Active" ? `
      <div class="task-actions">
        <select id="taskStatusSelect">
          <option value="Active">In Progress</option>
          <option value="Completed">Completed</option>
        </select>
        <button onclick="updateFromModal('${assignment.id}')">Update</button>
      </div>
    ` : ""}
  `;

  document.getElementById("projectModal").style.display = "flex";
};

window.updateFromModal = async function (id) {
  const status = document.getElementById("taskStatusSelect").value;
  if (status === "Completed" && !confirm("Mark this task as completed?")) return;

  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(API_BASE + `/worker/update-task/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      showToast("Task updated successfully", "success");
      closeModal();
      await loadAssignments();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to update", "error");
    }
  } catch (err) {
    showToast("Connection error", "error");
  }
};

window.closeModal = function () {
  document.getElementById("projectModal").style.display = "none";
};

document.getElementById("projectModal").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});

async function loadNotifications() {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(API_BASE + "/notifications", {
      headers: { Authorization: "Bearer " + token }
    });
    const notifs = await res.json();
    renderNotifications(notifs);
  } catch (err) {
    console.error("Failed to load notifications:", err);
  }
}

function renderNotifications(notifs) {
  const list = document.getElementById("workerNotifList");
  const badge = document.getElementById("notifBadge");
  const unread = notifs.filter(n => !n.read);

  if (unread.length > 0) {
    badge.textContent = unread.length;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }

  if (notifs.length === 0) {
    list.innerHTML = '<div class="notif-empty">No notifications</div>';
    return;
  }

  const iconMap = {
    assignment: "fa-user-plus",
    task_update: "fa-check-circle",
    approval: "fa-circle-check",
    rejection: "fa-circle-xmark",
    general: "fa-bell"
  };

  list.innerHTML = notifs.slice(0, 20).map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markRead('${n.id}')">
      <div class="notif-icon ${n.type || 'general'}">
        <i class="fa-solid ${iconMap[n.type] || iconMap.general}"></i>
      </div>
      <div class="notif-content">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-message">${escHtml(n.message)}</div>
        <div class="notif-time">${timeAgo(n.createdAt)}</div>
      </div>
    </div>
  `).join("");
}

window.markRead = async function (id) {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    await fetch(API_BASE + `/notifications/${id}/read`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token }
    });
    await loadNotifications();
  } catch (err) { /* silent */ }
};

async function markAllRead() {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    await fetch(API_BASE + "/notifications/read-all", {
      method: "POST",
      headers: { Authorization: "Bearer " + token }
    });
    await loadNotifications();
  } catch (err) { /* silent */ }
}

function setupNotifBell() {
  document.getElementById("notifBell").addEventListener("click", function () {
    const dropdown = document.getElementById("workerNotifDropdown");
    dropdown.classList.toggle("show");
  });

  document.addEventListener("click", function (e) {
    const dropdown = document.getElementById("workerNotifDropdown");
    const bell = document.getElementById("notifBell");
    if (!dropdown.contains(e.target) && !bell.contains(e.target)) {
      dropdown.classList.remove("show");
    }
  });

  setInterval(loadNotifications, 30000);
}

window.navigateTo = function (page) {
  currentPage = page;

  document.querySelectorAll(".sidebar-menu a").forEach(a => a.classList.remove("active"));
  const links = document.querySelectorAll(".sidebar-menu a");
  if (page === "assignments") links[0]?.classList.add("active");
  else if (page === "profile") links[2]?.classList.add("active");
  else links[0]?.classList.add("active");

  const content = document.getElementById("contentArea");
  const statsRow = document.getElementById("statsRow");
  const sectionTitle = document.getElementById("sectionTitle");
  const profileSection = document.getElementById("profileSection");
  const assignmentsList = document.getElementById("assignmentsList");
  const pageTitle = document.getElementById("pageTitle");

  if (page === "profile") {
    statsRow.style.display = "none";
    sectionTitle.parentElement.style.display = "none";
    assignmentsList.style.display = "none";
    profileSection.style.display = "block";
    pageTitle.textContent = "My Profile";
  } else {
    statsRow.style.display = "grid";
    sectionTitle.parentElement.style.display = "flex";
    assignmentsList.style.display = "grid";
    profileSection.style.display = "none";
    pageTitle.textContent = "Dashboard";

    if (page === "active") {
      sectionTitle.textContent = "Active Assignments";
    } else if (page === "completed") {
      sectionTitle.textContent = "Completed Assignments";
    } else {
      sectionTitle.textContent = "My Assignments";
    }
    renderAssignments();
  }
};

window.saveProfile = async function () {
  const name = document.getElementById("editName").value.trim();
  const phone = document.getElementById("editPhone").value.trim();
  const password = document.getElementById("editPassword").value.trim();

  if (!name) {
    showToast("Name is required", "error");
    return;
  }

  try {
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ name, phone })
      .eq("id", userId);

    if (profileErr) {
      showToast("Failed to update profile: " + profileErr.message, "error");
      return;
    }

    if (password) {
      if (password.length < 8) {
        showToast("Password must be at least 8 characters", "error");
        return;
      }
      const { error: passErr } = await supabase.auth.updateUser({ password });
      if (passErr) {
        showToast("Failed to update password: " + passErr.message, "error");
        return;
      }
    }

    document.getElementById("workerName").textContent = name;
    document.getElementById("profileName").textContent = name;
    showToast("Profile updated successfully", "success");
  } catch (err) {
    showToast("Connection error", "error");
  }
};

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "login.html";
};

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch (e) {
    return dateStr;
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return diffMin + "m ago";
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + "h ago";
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay + "d ago";
  return formatDate(dateStr);
}
