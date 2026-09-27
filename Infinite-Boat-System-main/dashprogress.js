import { supabase, supabaseUrl, handleDbError, API_BASE, ensureSession } from "./supabase.js";
import { BOAT_MILESTONES, BOAT_TIMELINE, SPECIALTY_PHASES, MILESTONE_KEY_LABELS, getPendingPhaseApprovals, getPhaseSpecialties, isCountedExpense, sumCountedExpenses, sumPendingExpenses } from "./boatData.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

function handleSessionExpired() {
  showToast("Session expired. Please log in again.", "error");
  setTimeout(() => { window.location.href = "login.html"; }, 1500);
}

const STORAGE_BUCKET = "boat-files";

function isManager() {
  return window.currentRole === "manager";
}

function isAdmin() {
  return window.currentRole === "admin";
}

function overrideOn() {
  return window.overrideUnlocked === true;
}

function canEdit() {
  return isManager() || (isAdmin() && overrideOn());
}

function canManageMoney() {
  return isAdmin();
}

function canLogExpense() {
  return isManager() || isAdmin();
}

function actorLabel() {
  if (isManager()) return "Project Manager";
  return overrideOn() ? "Admin (Override)" : "Admin";
}

window.overrideUnlocked = false;

const MANAGER_ONLY_BTN_IDS = [
  "addTaskBtn", "addWorkerBtn", "autoAssignBtn", "uploadDocBtn", "uploadProgressPhotoBtn",
  "addActivityBtn", "updateProgressBtn"
];

const MONEY_INPUT_IDS = [
  "budgetTotalInput", "expenseCategoryInput", "expenseDescInput", "expenseAmountInput"
];

function applyRoleLock() {
  MANAGER_ONLY_BTN_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = canEdit() ? "" : "none";
  });

  document.getElementById("setBudgetBtn").style.display = canManageMoney() ? "" : "none";
  MONEY_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "";
  });

  const banner = document.getElementById("readonlyBanner");
  if (banner) {
    if (canEdit()) {
      banner.style.display = "none";
    } else {
      banner.style.display = "block";
      banner.innerHTML = '<i class="fa-solid fa-eye"></i> <strong>Read-only view.</strong> You are monitoring this build. Only the Project Manager can change milestones, workers, tasks, documents, or delivery.';
    }
  }

  const overrideBanner = document.getElementById("overrideBanner");
  if (overrideBanner) overrideBanner.style.display = (isAdmin() && overrideOn()) ? "block" : "none";

  const toggle = document.getElementById("overrideToggleBtn");
  if (toggle) {
    toggle.style.display = isAdmin() ? "" : "none";
    toggle.innerHTML = overrideOn()
      ? '<i class="fa-solid fa-lock-open"></i> Release Editing'
      : '<i class="fa-solid fa-lock-open"></i> Take Over Editing';
  }
}

async function toggleOverride() {
  if (!isAdmin()) return;
  window.overrideUnlocked = !overrideOn();
  applyRoleLock();
  showToast(window.overrideUnlocked
    ? "Override unlocked. Your edits will be logged as Admin (Override)."
    : "Override released. Boat Progress is read-only again.", window.overrideUnlocked ? "warning" : "success");
  const order = getSelectedOrder();
  if (order) {
    await renderDetail(order);
    await logOverrideEvent(order, window.overrideUnlocked);
  }
}

async function logOverrideEvent(order, unlocked) {
  if (!order || !order.orderId) return;
  const log = Array.isArray(order.activityLog) ? order.activityLog.slice() : [];
  log.push({
    title: unlocked ? "Admin Override - Editing Unlocked" : "Admin Override - Editing Released",
    description: unlocked
      ? "Admin took over editing on behalf of the Project Manager."
      : "Admin released editing. Boat Progress returned to read-only.",
    date: new Date().toISOString(),
    personnel: "Admin",
    role: "Override"
  });
  order.activityLog = log;
  await handleDbError(
    supabase.from("boat_orders").update({ activityLog: log, updatedAt: new Date().toISOString() }).eq("orderId", order.orderId),
    "Log override"
  );
  renderActivityLog(order);
}

window.toggleOverride = toggleOverride;

const WORKER_REGISTRY = [
  { name: "Juan dela Cruz", specialty: "Builder" },
  { name: "Carlos Dimagiba", specialty: "Builder" },
  { name: "Ramon Salazar", specialty: "Welder" },
  { name: "Francisco Lopez", specialty: "Welder" },
  { name: "Engr. Maria Santos", specialty: "Engineer" },
  { name: "Engr. Robert Lim", specialty: "Engineer" },
  { name: "Pedro Reyes", specialty: "Electrician" },
  { name: "Jose Mercado", specialty: "Electrician" },
  { name: "Antonio Bautista", specialty: "Painter" },
  { name: "Miguel Torres", specialty: "Fiberglass Specialist" },
  { name: "Ricardo Navarro", specialty: "Fiberglass Specialist" },
  { name: "Jorge Villanueva", specialty: "Painter" },
];

async function ensureWorkerRegistry() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(API_BASE + "/workers/seed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ workers: WORKER_REGISTRY.map(w => ({ name: w.name, specialty: w.specialty })) })
    });
    if (!res.ok) {
      console.error("[WORKERS] Seed failed with status:", res.status);
      return;
    }
    const result = await res.json();
    if (result.seeded) {
      console.log("[WORKERS] Seeded " + result.count + " workers");
    }
  } catch (err) {
    console.error("[WORKERS] Seed error:", err);
  }
}

async function backfillRegistry() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(API_BASE + "/workers/backfill", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      }
    });
    if (!res.ok) {
      console.error("[WORKERS] Backfill failed with status:", res.status);
      return;
    }
    const result = await res.json();
    if (result.added > 0) console.log("[WORKERS] Backfilled " + result.added + " approved workers");
  } catch (err) {
    console.error("[WORKERS] Backfill error:", err);
  }
}

let orders = [];
const select = document.getElementById("orderSelect");

function getBoatMilestones(boatName) {
  if (boatName && BOAT_MILESTONES[boatName]) return BOAT_MILESTONES[boatName];
  const match = Object.keys(BOAT_MILESTONES).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
  return match ? BOAT_MILESTONES[match] : BOAT_MILESTONES["Passenger Boat"];
}

function getBuildStage(progress, status, order) {
    if (status === "Rejected") return "Order Rejected";
    if (status === "Under Review") return "Under Engineering Review";
    if (status === "Revision Required") return "Revision Requested";
    if (status === "Pending Signing") return "Awaiting Contract Signing";
    if (status === "Cancellation Requested") return "Cancellation Requested";
    if (status === "Cancelled") return "Cancelled";
    if (status === "Pending" || progress === 0) {
        if (order && order.paymentMethod === "Full Payment") return "Waiting For Full Payment";
        return "Waiting For Downpayment";
    }
    if (progress >= 100) return "Boat Completed - Ready for Delivery";
    if (progress >= 70) return "Painting & Finishing";
    if (progress >= 45) return "Interior Installation";
    if (progress >= 25) return "Engine Assembly";
    return "Hull Construction";
}

function getStatusClass(status) {
    if (status === "Approved" || status === "Completed") return "approved";
    if (status === "Rejected" || status === "Cancelled") return "rejected";
    return "pending";
}

async function getDBWorkers(orderId) {
    if (!orderId) return [];
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(API_BASE + "/workers/" + orderId, {
            headers: token ? { Authorization: "Bearer " + token } : {}
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.error("Failed to load workers:", e);
        return [];
    }
}

async function addDBWorker(orderId, name, role, type) {
  if (!canEdit()) return;
    try {
        const token = await ensureSession();
        if (!token) { handleSessionExpired(); return null; }
        const res = await fetch(API_BASE + "/workers", {
          method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: "Bearer " + token } : {})
            },
            body: JSON.stringify({ orderId, name, role, specialty: role, status: "Active" })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.error || "Failed to add worker");
        }
        return await res.json();
    } catch (e) {
        console.error("Failed to add worker:", e);
        alert(e?.message || "Failed to add worker.");
        return null;
    }
}

async function removeDBWorker(workerId) {
    try {
        const token = await ensureSession();
        if (!token) { handleSessionExpired(); return; }
        await fetch(API_BASE + "/workers/" + workerId, {
            method: "DELETE",
            headers: token ? { Authorization: "Bearer " + token } : {}
        });
    } catch (e) {
        console.error("Failed to remove worker:", e);
    }
}

async function releaseWorkersForPhase(orderId, phase) {
    try {
        const token = await ensureSession();
        if (!token) { handleSessionExpired(); return null; }
        const res = await fetch(API_BASE + "/workers/release-phase/" + orderId, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: "Bearer " + token } : {})
            },
            body: JSON.stringify({ phase })
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error("Failed to release phase workers:", e);
        return null;
    }
}

function getMilestoneKeyLabel(key) {
    return MILESTONE_KEY_LABELS[key] || key || "";
}

function getOrderMilestones(order) {
  if (order.milestones && order.milestones.length > 0) {
    const presets = getBoatMilestones(order.boatName);
    return order.milestones.map((m, i) => {
      if (m.key) return m;
      const preset = (presets || [])[i] || (presets || []).find(p => p.percentage === m.percentage);
      return { ...m, key: preset ? preset.key : "" };
    });
  }
  const presets = getBoatMilestones(order.boatName);
  const ms = presets.map((p, i) => ({
    label: p.label,
    percentage: p.percentage,
    key: p.key,
    completed: order.progress >= p.percentage,
    completedDate: order.progress >= p.percentage ? (order.projectCompletedDate || new Date().toISOString()) : null,
    history: []
  }));
  order.milestones = ms;
  return ms;
}

function phaseKeyAtProgress(order, progress) {
  const presets = getBoatMilestones(order.boatName) || [];
  const active = presets.find(p => progress < p.percentage);
  return active ? active.key : "";
}

function getOrderActivityLog(order) {
  return order.activityLog || [];
}

async function saveOrderMilestones(order, milestones) {
  order.milestones = milestones;
  await handleDbError(
    supabase.from("boat_orders").update({ milestones }).eq("orderId", order.orderId),
    "Save milestones"
  );
}

async function saveOrderActivityLog(order, log) {
  order.activityLog = log;
  await handleDbError(
    supabase.from("boat_orders").update({ activityLog: log }).eq("orderId", order.orderId),
    "Save activity log"
  );
}

async function renderMilestones(order, readonly = false) {
  const container = document.getElementById("milestonesList");
  if (!container) return;
  const milestones = getOrderMilestones(order);
  if (!order || order.status !== "Approved") {
    container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">Milestones available once order is Approved.</span>';
    return;
  }
  const workers = await getDBWorkers(order.orderId);
  if (readonly || workers.length === 0) {
    container.innerHTML = `
      <div style="padding:12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;font-size:13px;color:#991b1b;text-align:center;">
        <i class="fa-solid fa-users-gear"></i> Assign workers first to unlock milestone tracking.
      </div>
    `;
    return;
  }
  const workersByPhase = {};
  workers.forEach(w => {
    if (!w.phase) return;
    (workersByPhase[w.phase] = workersByPhase[w.phase] || []).push(w);
  });
  container.innerHTML = milestones.map((m, i) => {
    const completed = m.completed;
    const phaseWorkers = workersByPhase[m.key || ""] || [];
    const needs = getPhaseSpecialties(m.key || "");
    const needsHtml = needs.length > 0
      ? '<div style="font-size:11px;color:#64748b;margin-top:4px;"><i class="fa-solid fa-wrench"></i> Needs: ' + needs.join(" · ") + '</div>'
      : '';
    const workerLine = phaseWorkers.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
          ${phaseWorkers.map(w => {
            const st = w.status === "Completed"
              ? '<span class="worker-status-badge done">Done</span>'
              : '<span class="worker-status-badge active">Working</span>' + workerDueChip(w);
            return '<span class="mini-worker-chip"><i class="fa-solid fa-user"></i>' + w.name + ' ' + st + '</span>';
          }).join('')}
         </div>`
      : '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">No workers assigned for this phase.</div>';
    return `
    <div style="padding:8px 12px;border-radius:10px;background:${completed ? '#f0fdf4' : '#f8fafc'};border:1px solid ${completed ? '#bbf7d0' : '#e2e8f0'};">
      <div style="display:flex;align-items:center;gap:10px;${canEdit() ? 'cursor:pointer;' : ''}" ${canEdit() ? `onclick="toggleMilestone(${i})"` : ''}>
      <div style="width:22px;height:22px;border-radius:50%;background:${completed ? '#22c55e' : '#e2e8f0'};display:flex;align-items:center;justify-content:center;color:white;font-size:12px;flex-shrink:0;">
        ${completed ? '<i class="fa-solid fa-check"></i>' : ''}
      </div>
      <div style="flex:1;">
        <strong style="font-size:13px;color:${completed ? '#16a34a' : '#334155'};display:block;">${m.label}</strong>
        <span style="font-size:11px;color:#64748b;">${m.percentage}% — ${completed ? (m.completedDate ? new Date(m.completedDate).toLocaleDateString() : 'Completed') : 'Pending'}</span>
      </div>
      ${m.history && m.history.length > 0 ? `<span style="font-size:11px;color:#2563eb;"><i class="fa-solid fa-clock-rotate-left"></i> ${m.history.length}</span>` : ''}
      </div>
      ${needsHtml}
      ${workerLine}
    </div>`;
  }).join("");
}

function getPaymentGate(paymentStep) {
  const gates = { 0: 0, 1: 40, 2: 75, 3: 100 };
  return gates[paymentStep] || 0;
}

function getWorkerDueStatus(w) {
  if (!w || w.status !== "Active" || !w.endDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(w.endDate); end.setHours(0, 0, 0, 0);
  if (isNaN(end.getTime())) return null;
  const diffDays = Math.round((end - today) / 86400000);
  if (diffDays < 0) return { label: "Overdue", cls: "overdue", days: Math.abs(diffDays) };
  if (diffDays <= 3) return { label: "Due Soon", cls: "due-soon", days: diffDays };
  return { label: "On Track", cls: "on-track", days: diffDays };
}

function workerDueChip(w) {
  const s = getWorkerDueStatus(w);
  if (!s) return "";
  const daysText = s.cls === "overdue" ? " " + s.days + "d overdue" : (s.cls === "due-soon" ? " in " + s.days + "d" : "");
  const dateText = w.endDate ? " · Due " + new Date(w.endDate).toLocaleDateString() : "";
  return '<span class="due-chip ' + s.cls + '">' + s.label + daysText + dateText + '</span>';
}

function renderPendingApprovals(order, workers) {
  const card = document.getElementById("pendingApprovalsCard");
  const list = document.getElementById("pendingApprovalsList");
  if (!card || !list) return;
  const pending = getPendingPhaseApprovals(order, workers || []);
  if (!order || order.status !== "Approved" || pending.length === 0) {
    card.style.display = "none";
    list.innerHTML = "";
    return;
  }
  card.style.display = "block";
  list.innerHTML = pending.map(p => {
    const dateText = p.completedAt ? new Date(p.completedAt).toLocaleDateString() : "";
    return `
      <div style="padding:10px 12px;border:1px solid #fbcfe8;background:#fdf2f8;border-radius:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <strong style="font-size:13px;color:#86198f;display:block;">${p.label}</strong>
            <span style="font-size:11px;color:#a21caf;">${p.pct}% — ${p.workersDone}/${p.workersTotal} workers finished${dateText ? ' · ' + dateText : ''}</span>
          </div>
          ${canEdit() ? `<button onclick="approvePhase('${p.phaseKey}')" class="approve-phase-btn">Approve</button>` : ''}
        </div>
      </div>`;
  }).join("");
}

async function approvePhase(phaseKey) {
  if (!canEdit()) return;
  const order = getSelectedOrder();
  if (!order || !order.orderId) return;
  const confirmed = confirm("Approve the " + getMilestoneKeyLabel(phaseKey) + " phase for " + (order.boatName || order.orderId) + "?");
  if (!confirmed) return;
  try {
    const token = await ensureSession();
    if (!token) { handleSessionExpired(); return; }
    const res = await fetch(API_BASE + "/worker/approve-phase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      body: JSON.stringify({ orderId: order.orderId, phaseKey })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data?.error || "Approval failed.", "error");
      return;
    }
    showToast("Phase approved successfully.", "success");
    const idx = parseInt(select.value);
    const refreshed = await handleDbError(
      supabase.from("boat_orders").select("*").eq("orderId", order.orderId).maybeSingle(),
      "Refresh order"
    );
    if (refreshed && !refreshed.error && refreshed.data && !isNaN(idx)) {
      orders[idx] = refreshed.data;
    }
    await renderDetail(getSelectedOrder());
    renderActivityLog(getSelectedOrder());
  } catch (e) {
    console.error("Approve phase error:", e);
    showToast("Approval error.", "error");
  }
}

async function toggleMilestone(index) {
  if (!canEdit()) return;
  const order = getSelectedOrder();
  if (!order || order.status !== "Approved") return;
  const ww = await getDBWorkers(order.orderId);
  if (ww.length === 0) {
    showToast("Assign workers first before updating milestones.", "warning");
    return;
  }
  const milestones = getOrderMilestones(order);
  const m = milestones[index];
  let releasedPhaseKey = "";
  if (m.completed) {
    m.completed = false;
    milestones.forEach((ms, i) => {
      if (i >= index) {
        ms.completed = false;
        ms.completedDate = null;
      }
    });
    const firstRemaining = milestones.find(ms => !ms.completed);
    order.progress = firstRemaining ? Math.max(0, firstRemaining.percentage - 1) : 0;
    order.status = "Approved";
    order.orderPhase = "Approved";
    showToast("Milestone reopened. Workers for previous phases were already released — reassign manually if needed.", "warning");
  } else {
    const prevMilestones = milestones.filter(ms => ms.percentage < m.percentage);
    if (!prevMilestones.every(ms => ms.completed)) {
      showToast("Complete previous milestones first.", "warning");
      return;
    }
    const maxProgress = getPaymentGate(order.paymentStep || 0);
    if (m.percentage > maxProgress) {
      const needed = maxProgress === 0 ? "Downpayment" : maxProgress === 40 ? "Mid-Construction Payment" : "Final Payment";
      showToast("Required payment not completed yet. Complete " + needed + " first.", "warning");
      return;
    }
    if (m.percentage === 100 && Number(order.remainingBalance || 0) > 0) {
      showToast("Order must be fully paid before completion.", "warning");
      return;
    }
    m.completed = true;
    m.completedDate = new Date().toISOString();
    order.progress = m.percentage;
    if (m.percentage === 100) {
      order.status = "Completed";
      order.orderPhase = "Completed";
      order.projectCompletedDate = new Date().toISOString();
    } else if (m.percentage >= 70) {
      order.orderPhase = "Painting & Finishing";
    } else if (m.percentage >= 45) {
      order.orderPhase = "Interior Installation";
    } else if (m.percentage >= 25) {
      order.orderPhase = "Engine Assembly";
    } else {
      order.orderPhase = m.label;
    }
    addAutoActivityLog(order, m);

    // Phase-based worker scheduling: release this phase's workers, then
    // auto-assign the required-specialty workers for the NEXT phase.
    releasedPhaseKey = m.key || "";
    if (releasedPhaseKey) {
      await releaseWorkersForPhase(order.orderId, releasedPhaseKey);
    }
  }
  order.milestones = milestones;
  const result = await handleDbError(
    supabase.from("boat_orders").update({
      status: order.status, progress: order.progress, orderPhase: order.orderPhase,
      milestones, projectCompletedDate: order.projectCompletedDate || null
    }).eq("orderId", order.orderId),
    "Toggle milestone"
  );
  if (result?.error) return;

  let autoMsg = null;
  if (m.completed && releasedPhaseKey && m.percentage < 100) {
    const assign = await autoAssignForOrder(order.orderId);
    if (assign.ok && assign.count > 0) {
      autoMsg = "Released " + getMilestoneKeyLabel(releasedPhaseKey) + " workers. Auto-assigned " + assign.count + " worker(s) for " + (getMilestoneKeyLabel(assign.phase) || "the next phase") + ".";
    } else {
      autoMsg = "Released " + getMilestoneKeyLabel(releasedPhaseKey) + " workers. No available workers to auto-assign for the next phase — assign manually.";
    }
  }
  if (autoMsg) showToast(autoMsg, "success");

  await renderDetail(order);
  renderActivityLog(order);
  updateProgressInput(order);
}

const BOAT_ACTIVITY_PRESETS = {
  "Passenger Boat": {
    "Design": [
      "Initial hull and cabin layout design completed",
      "Passenger capacity and seating arrangement finalized",
      "Aesthetic and color scheme approved by customer"
    ],
    "Engineering": [
      "Structural analysis of hull and cabin completed",
      "MARINA compliance check passed",
      "Electrical system and plumbing schematics approved"
    ],
    "Marina": [
      "MARINA passenger vessel application submitted",
      "Safety equipment checklist filed with MARINA",
      "Certificate of Public Convenience documentation prepared"
    ],
    "Construction": [
      "Fiberglass hull lay-up completed",
      "Cabin framing and roofing installed",
      "Engine bed alignment and mounting completed"
    ],
    "Outfitting": [
      "Interior seating and flooring installation completed",
      "HVAC and electrical system wiring completed",
      "Plumbing and sanitation fixtures installed"
    ],
    "Sea Trial": [
      "Stability and maneuverability test conducted",
      "Engine performance and fuel consumption tested",
      "Passenger safety systems verified"
    ],
    "Delivery": [
      "Final inspection and touch-up completed",
      "Owner orientation and handover completed",
      "Delivery documentation signed"
    ]
  },
  "Patrol Boat": {
    "Design": [
      "Patrol vessel hull design and layout approved",
      "Weapon mount and equipment placement finalized",
      "Crew accommodation layout completed"
    ],
    "Engineering": [
      "Reinforced hull stress analysis completed",
      "Navigation and communication systems designed",
      "Engine and propulsion system specified"
    ],
    "Marina": [
      "MARINA patrol vessel registration filed",
      "Coast guard compliance documents submitted",
      "Armed vessel endorsement application completed"
    ],
    "Construction": [
      "Heavy-duty fiberglass hull lay-up completed",
      "Cockpit and helm station framed",
      "Engine room and fuel tank installation completed"
    ],
    "Systems": [
      "Radar, GPS and comms integration completed",
      "Weapon mount and safety systems installed",
      "Night navigation lighting installed"
    ],
    "Sea Trial": [
      "High-speed maneuverability test completed",
      "Weapon system safety check conducted",
      "Communication and radar range verified"
    ],
    "Delivery": [
      "Final inspection and systems check completed",
      "Crew training on patrol operations conducted",
      "Delivery acceptance signed"
    ]
  },
  "Speed Boat": {
    "Design": [
      "Sleek hull design and deck layout finalized",
      "Engine and propulsion configuration approved",
      "Upholstery and color scheme selected"
    ],
    "Engineering": [
      "High-speed hull stress analysis completed",
      "Engine cooling and exhaust system designed",
      "Electrical and instrumentation layout finalized"
    ],
    "Marina": [
      "MARINA speed craft registration submitted",
      "Safety gear compliance checklist completed",
      "Registration documents processed"
    ],
    "Construction": [
      "Fiberglass hull and deck lay-up completed",
      "Engine stringers and transom reinforcement completed",
      "Gel coat finish applied"
    ],
    "Outfitting": [
      "Engine and sterndrive installation completed",
      "Electrical panel and dashboard wiring completed",
      "Interior upholstery and carpeting installed"
    ],
    "Sea Trial": [
      "Top speed and acceleration test conducted",
      "Handling and turning radius verified",
      "Trim and balance adjustment completed"
    ],
    "Delivery": [
      "Final detail and polish completed",
      "Owner orientation and safety briefing completed",
      "Warranty documents handed over"
    ]
  },
  "Parasail Boat": {
    "Design": [
      "Parasail vessel hull design approved",
      "Winch and tow pylon placement finalized",
      "Passenger seating and boarding layout completed"
    ],
    "Engineering": [
      "Winch system load and stress analysis completed",
      "Tow pylon reinforcement design approved",
      "Hydraulic and electrical winch schematics finalized"
    ],
    "Marina": [
      "MARINA commercial tow vessel registration filed",
      "Parasail operations permit application submitted",
      "Safety equipment and harness inspection completed"
    ],
    "Construction": [
      "Hull lay-up and deck molding completed",
      "Engine and jet drive installation completed",
      "Tow pylon base reinforcement completed"
    ],
    "Winch": [
      "Winch drum and hydraulic motor installed",
      "Tow line and swivel assembly rigged",
      "Roller and guide system installed"
    ],
    "Sea Trial": [
      "Winch load test under tow conducted",
      "Parasail deployment and recovery tested",
      "Stability under tow verified"
    ],
    "Delivery": [
      "Final safety inspection completed",
      "Crew training on parasail operations conducted",
      "Commercial operations documentation signed"
    ]
  }
};

function getActivityPresets(boatName) {
  if (boatName && BOAT_ACTIVITY_PRESETS[boatName]) return BOAT_ACTIVITY_PRESETS[boatName];
  const match = Object.keys(BOAT_ACTIVITY_PRESETS).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
  return match ? BOAT_ACTIVITY_PRESETS[match] : BOAT_ACTIVITY_PRESETS["Passenger Boat"];
}

function getAutoDescription(milestoneKey, boatName) {
  const presets = getActivityPresets(boatName);
  const phaseMap = {
    "design": "Design",
    "engineering": "Engineering",
    "marina": "Marina",
    "construction": "Construction",
    "outfitting": "Outfitting",
    "systems": "Systems",
    "winch": "Winch",
    "seatrial": "Sea Trial",
    "delivery": "Delivery"
  };
  const phase = phaseMap[milestoneKey];
  if (phase && presets[phase] && presets[phase].length > 0) {
    return presets[phase][0];
  }
  return "Milestone achieved: " + milestoneKey;
}

function addAutoActivityLog(order, milestone) {
  const log = getOrderActivityLog(order);
  const entry = {
    title: milestone.label,
    description: getAutoDescription(milestone.key, order.boatName),
    date: new Date().toISOString(),
    personnel: "System",
    role: "Automated"
  };
  log.push(entry);
  saveOrderActivityLog(order, log);
}

function renderActivityLog(order) {
  const container = document.getElementById("activityFeed");
  if (!container) return;
  const log = getOrderActivityLog(order);
  if (!log || log.length === 0) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">No activity entries yet. Post updates above.</span>';
    return;
  }
  container.innerHTML = log.slice().reverse().map(e =>
    `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
        <strong style="font-size:13px;color:#0f172a;">${e.title}</strong>
        <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${new Date(e.date).toLocaleString()}</span>
      </div>
      <p style="font-size:12px;color:#475569;margin-bottom:4px;">${e.description || ''}</p>
      <span style="font-size:11px;color:#64748b;">${e.personnel || 'System'} — ${e.role || ''}</span>
    </div>`
  ).join("");
}

function updateProgressInput(order) {
  const updateBtn = document.getElementById("updateProgressBtn");
  const progressInput = document.getElementById("progressInput");
  if (order && order.status === "Approved" && (order.progress || 0) < 100) {
    updateBtn.style.display = "block";
    progressInput.style.display = "";
    updateBtn.disabled = false;
  } else {
    updateBtn.style.display = "none";
    progressInput.style.display = "none";
  }
}

function populateSelect() {
    const active = orders.filter(o => o.status !== "Cancelled" && o.status !== "Rejected" && o.status !== "Completed");
    const completed = orders.filter(o => o.status === "Completed");
    active.forEach(o => {
        const opt = document.createElement("option");
        opt.value = orders.indexOf(o);
        opt.textContent = o.boatName + " — " + (o.customerName || "Unknown") + " (" + o.status + ")";
        select.appendChild(opt);
    });
    if (completed.length > 0) {
        const sep = document.createElement("option");
        sep.disabled = true;
        sep.textContent = "─ Completed Orders ─";
        select.appendChild(sep);
        completed.forEach(o => {
            const opt = document.createElement("option");
            opt.value = orders.indexOf(o);
            opt.textContent = o.boatName + " — " + (o.customerName || "Unknown") + " (Completed)";
            select.appendChild(opt);
        });
    }
    if (active.length === 0 && completed.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No orders found";
        opt.disabled = true;
        select.appendChild(opt);
    }
}

async function renderWorkers(orderId) {
    const container = document.getElementById("storedWorkersList");
    if (!container) return;
    const workers = await getDBWorkers(orderId);
    if (workers.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No workers assigned.</span>';
        return;
    }
    container.innerHTML = workers.map(w => {
        const isActive = w.status === "Active";
        const phaseLabel = getMilestoneKeyLabel(w.phase);
        return '<span class="worker-chip' + (w.role ? ' role-' + w.role.toLowerCase().replace(/\s+/g, '-') : '') + '" style="flex-wrap:wrap;">' +
            '<i class="fa-solid fa-user"></i>' +
            w.name + ' — <strong>' + (w.specialty || w.role) + '</strong>' +
            (phaseLabel ? ' <span class="worker-phase-badge">' + phaseLabel + '</span>' : '') +
            ' <span class="worker-status-badge ' + (isActive ? 'active' : 'done') + '">' + (isActive ? 'Working' : 'Completed') + '</span>' +
            (isActive ? workerDueChip(w) : '') +
            (isActive && canEdit() ? ' <i class="fa-solid fa-xmark" style="cursor:pointer;color:#ef4444;margin-left:4px;" onclick="removeWorker(\'' + w.id + '\')"></i>' : '') +
            '</span>';
    }).join('');
}

async function removeWorker(workerId) {
  if (!canEdit()) return;
    await removeDBWorker(workerId);
    const order = getSelectedOrder();
    if (order) {
        await renderWorkers(order.orderId);
        await renderDetail(order);
    }
}

function getBoatRef(orderId) {
    if (!orderId) return null;
    const order = orders.find(o => o.orderId === orderId);
    if (!order) return null;
    return { boatName: order.boatName || "", customerName: order.customerName || "" };
}

async function renderMasterWorkers() {
    const container = document.getElementById("masterWorkersList");
    if (!container) return;
    const filter = document.getElementById("masterSpecialtyFilter")?.value || "";
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(API_BASE + "/workers/master", {
            headers: token ? { Authorization: "Bearer " + token } : {}
        });
        if (!res.ok) { container.innerHTML = '<span style="color:#94a3b8;font-size:11px;">Failed to load workers.</span>'; return; }
        let workers = await res.json();
        if (filter) workers = workers.filter(w => (w.specialty || "") === filter);
        if (workers.length === 0) {
            container.innerHTML = '<span style="color:#94a3b8;font-size:11px;">No workers found.</span>';
            return;
        }
        container.innerHTML = workers.map(w => {
            const available = w.available !== false;
            const ref = getBoatRef(w.currentOrderId);
            const phaseLabel = getMilestoneKeyLabel(w.currentPhase);
            const statusHtml = available
                ? '<span class="worker-status-badge active">Available</span>'
                : '<span class="worker-status-badge busy">Busy</span>';
            const assignHtml = (!available && ref)
                ? ' <span style="font-size:11px;color:#2563eb;">→ ' + (ref.boatName || 'Boat') + (ref.customerName ? ' (' + ref.customerName + ')' : '') + (phaseLabel ? ' · ' + phaseLabel : '') + '</span>'
                : '';
            return '<span class="worker-chip" style="flex-wrap:wrap;width:100%;justify-content:space-between;">' +
                '<span><i class="fa-solid fa-user"></i> ' + w.name + ' — <strong>' + (w.specialty || 'Builder') + '</strong></span>' +
                '<span style="display:inline-flex;align-items:center;gap:6px;">' + assignHtml + statusHtml + '</span>' +
                '</span>';
        }).join("");
    } catch (e) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:11px;">Failed to load workers.</span>';
    }
}

document.getElementById("masterSpecialtyFilter")?.addEventListener("change", renderMasterWorkers);

async function populateWorkerSelect() {
  const sel = document.getElementById("workerNameInput");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a worker —</option>';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    let res = await fetch(API_BASE + "/workers/master", {
      headers: token ? { Authorization: "Bearer " + token } : {}
    });
    if (!res.ok) {
      console.error("[WORKERS] /workers/master returned", res.status, await res.text().catch(() => ""));
    }
    let workers = res.ok ? await res.json() : [];

    if (!workers.length) {
      await ensureWorkerRegistry();
      res = await fetch(API_BASE + "/workers/master", {
        headers: token ? { Authorization: "Bearer " + token } : {}
      });
      workers = res.ok ? await res.json() : [];
    }

    const currentOrder = getSelectedOrder();
    const currentOrderId = currentOrder?.orderId || '';

    workers.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w.name;
      const busyOnOther = w.available === false && w.currentOrderId && w.currentOrderId !== currentOrderId;
      opt.textContent = w.name + ' — ' + w.specialty + (busyOnOther ? ' (busy — assigned to another project)' : (w.available === false ? ' (busy)' : ''));
      opt.disabled = busyOnOther;
      opt.dataset.specialty = w.specialty;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error("Failed to populate worker select:", e);
  }
}

window.addEventListener("focus", function() {
  if (document.getElementById("workerNameInput")) {
    populateWorkerSelect();
  }
  if (document.getElementById("masterWorkersList")) {
    renderMasterWorkers();
  }
});

document.getElementById("workerNameInput")?.addEventListener("change", function() {
  const sel = document.getElementById("workerRoleInput");
  if (!sel) return;
  const selected = this.options[this.selectedIndex];
  if (selected && selected.dataset.specialty) {
    const idx = Array.from(sel.options).findIndex(o => o.text === selected.dataset.specialty);
    if (idx >= 0) sel.selectedIndex = idx;
  }
});

document.getElementById("addWorkerBtn")?.addEventListener("click", async () => {
    const order = getSelectedOrder();
    if (!order) return;
    const id = order.orderId;
    if (!id) return;
    const sel = document.getElementById("workerNameInput");
    if (!sel.value) { alert("Please select a worker."); return; }
    const name = sel.value;
    const roleLabel = document.getElementById("workerRoleInput").options[document.getElementById("workerRoleInput").selectedIndex].text;
    await addDBWorker(id, name, roleLabel, document.getElementById("workerRoleInput").value);
    await populateWorkerSelect();
    await renderWorkers(id);
    await renderMasterWorkers();
    await renderDetail(order);
});

async function autoAssignForOrder(orderId) {
  try {
    const token = await ensureSession();
    if (!token) { handleSessionExpired(); return { ok: false, count: 0, phase: "", skipped: [] }; }
    const res = await fetch(API_BASE + "/workers/auto-assign/" + orderId, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Auto-assign failed:", res.status, data?.error);
      return { ok: false, count: 0, phase: "", skipped: [], error: data?.error || "Auto-assign failed" };
    }
    return { ok: true, count: data?.count || 0, phase: data?.phase || "", skipped: data?.skipped || [] };
  } catch (e) {
    console.error("Auto-assign failed:", e);
    return { ok: false, count: 0, phase: "", skipped: [], error: e?.message || "Auto-assign failed" };
  }
}

document.getElementById("autoAssignBtn")?.addEventListener("click", async () => {
    const order = getSelectedOrder();
    if (!order) return;
    const id = order.orderId;
    if (!id) return;
    if (!confirm("Auto-assign available workers for the current phase?")) return;
    const data = await autoAssignForOrder(id);
    if (!data.ok) { alert(data?.error || "Auto-assign failed."); return; }
    const skipped = (data.skipped || []).filter(s => s.reason === "busy").map(s => s.name);
    const msg = (data.count || 0) + " worker(s) auto-assigned for phase '" + (getMilestoneKeyLabel(data.phase) || data.phase || "") + "'.";
    showToast(skipped.length > 0 ? msg + " Skipped busy workers: " + skipped.join(", ") : msg, 'success');
    await populateWorkerSelect();
    await renderWorkers(id);
    await renderMasterWorkers();
    await renderDetail(order);
});

function parseDurationToDays(durationStr) {
  const num = parseInt(durationStr);
  if (durationStr.includes("Week")) return num * 7;
  if (durationStr.includes("Day")) return num;
  if (durationStr.includes("Month")) return num * 30;
  return 7;
}

function getGanttData(order) {
  const tl = BOAT_TIMELINE[order.boatName];
  if (!tl) return null;
  const phases = tl.phases.map(p => {
    const parts = p.split(" - ");
    const name = parts[0];
    const duration = parts[1] || "";
    const days = parseDurationToDays(duration);
    return { name, duration, days };
  });
  const totalDays = phases.reduce((s, p) => s + p.days, 0);
  const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
  let currentOffset = 0;
  const progress = order.progress || 0;
  const phaseCount = phases.length;
  const step = 100 / phaseCount;
  return phases.map((p, i) => {
    const startOffset = currentOffset;
    currentOffset += p.days;
    const phaseStart = i * step;
    const phaseEnd = (i + 1) * step;
    const isCompleted = progress >= phaseEnd;
    const isCurrent = !isCompleted && progress >= phaseStart;
    const fillPct = isCompleted ? 100 : isCurrent ? ((progress - phaseStart) / step) * 100 : 0;
    const startDate = new Date(orderDate.getTime() + startOffset * 86400000);
    const endDate = new Date(orderDate.getTime() + (startOffset + p.days) * 86400000);
    return { ...p, startOffset, pct: 100, fillPct, isCompleted, isCurrent, startDate, endDate };
  });
}

function renderGanttChart(order) {
  const container = document.getElementById("ganttChartContainer");
  if (!container) return;
  if (!order || order.status !== "Approved") {
    container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">Gantt chart available once order is Approved.</span>';
    return;
  }
  const ganttData = getGanttData(order);
  if (!ganttData) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No timeline data for this boat type.</span>';
    return;
  }
  const totalDuration = BOAT_TIMELINE[order.boatName]?.totalDuration || "";
  container.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;color:#64748b;">Total Duration: <strong>${totalDuration}</strong></div>
    <div class="gantt-chart">
      ${ganttData.map(p => `
        <div class="gantt-row">
          <div class="gantt-label">
            <strong>${p.name}</strong>
            <span>${p.duration}</span>
          </div>
          <div class="gantt-track">
            <div class="gantt-bar ${p.isCompleted ? 'completed' : p.isCurrent ? 'current' : ''}" style="width:${Math.round(p.fillPct)}%">
              <span class="gantt-bar-label">${p.isCompleted ? '✓' : p.isCurrent ? Math.round(p.fillPct) + '%' : ''}</span>
            </div>
            <div class="gantt-pct">${p.isCompleted ? '100%' : p.isCurrent ? Math.round(p.fillPct) + '%' : '0%'}</div>
          </div>
          <div class="gantt-dates">
            <span>${p.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span>${p.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/* =============================================
   TASK MANAGEMENT
   ============================================= */

let currentTaskFilter = "all";
let allTasks = [];

async function loadTasks(orderId) {
  if (!orderId) { allTasks = []; return; }
  const result = await handleDbError(
    supabase.from("project_tasks").select("*").eq("orderId", orderId).order("createdAt", { ascending: false }),
    "Load tasks"
  );
  allTasks = (result && !result.error ? result.data : []) || [];
  return allTasks;
}

async function addTask(orderId) {
  if (!canEdit()) return;
  const title = document.getElementById("taskTitleInput").value.trim();
  if (!title) { alert("Please enter a task title."); return; }
  const description = document.getElementById("taskDescInput").value.trim();
  const assignedTo = document.getElementById("taskAssignInput").value.trim();
  const priority = document.getElementById("taskPriorityInput").value;
  const dueDate = document.getElementById("taskDueInput").value || null;

  const result = await handleDbError(
    supabase.from("project_tasks").insert({
      orderId, title, description, assignedTo, priority,
      status: "Not Started", dueDate
    }).select(),
    "Add task"
  );
  if (result?.error) return;

  document.getElementById("taskTitleInput").value = "";
  document.getElementById("taskDescInput").value = "";
  document.getElementById("taskAssignInput").value = "";
  document.getElementById("taskDueInput").value = "";

  await loadTasks(orderId);
  renderTasks();
}

async function updateTaskStatus(taskId, newStatus) {
  if (!canEdit()) return;
  const result = await handleDbError(
    supabase.from("project_tasks").update({ status: newStatus }).eq("id", taskId),
    "Update task status"
  );
  if (result?.error) return;
  const task = allTasks.find(t => t.id === taskId);
  if (task) task.status = newStatus;
  renderTasks();
}

async function deleteTask(taskId) {
  if (!canEdit()) return;
  if (!confirm("Delete this task?")) return;
  const result = await handleDbError(
    supabase.from("project_tasks").delete().eq("id", taskId),
    "Delete task"
  );
  if (result?.error) return;
  allTasks = allTasks.filter(t => t.id !== taskId);
  renderTasks();
}

function setTaskFilter(filter) {
  currentTaskFilter = filter;
  document.querySelectorAll(".task-filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  renderTasks();
}

function renderTasks() {
  const container = document.getElementById("tasksList");
  if (!container) return;

  let filtered = allTasks;
  if (currentTaskFilter !== "all") {
    filtered = allTasks.filter(t => t.status === currentTaskFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">No tasks found.</span>';
    return;
  }

  container.innerHTML = filtered.map(t => {
    const priorityColors = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };
    const pColor = priorityColors[t.priority] || "#94a3b8";
    const statusNext = t.status === "Not Started" ? "In Progress" : t.status === "In Progress" ? "Done" : "Not Started";
    const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done";
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:${t.status === 'Done' ? '#f0fdf4' : '#f8fafc'};border:1px solid ${t.status === 'Done' ? '#bbf7d0' : isOverdue ? '#fca5a5' : '#e2e8f0'};">
        <div style="${canEdit() ? 'cursor:pointer;' : ''}width:20px;height:20px;border-radius:50%;background:${t.status === 'Done' ? '#22c55e' : '#e2e8f0'};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;flex-shrink:0;" ${canEdit() ? `onclick="window.updateTaskStatus('${t.id}','${statusNext}')"` : ''}>
          ${t.status === 'Done' ? '<i class="fa-solid fa-check"></i>' : ''}
        </div>
        <div style="flex:1;min-width:0;">
          <strong style="font-size:12px;color:${t.status === 'Done' ? '#16a34a' : '#0f172a'};display:block;text-decoration:${t.status === 'Done' ? 'line-through' : 'none'};">${t.title}</strong>
          ${t.description ? `<span style="font-size:11px;color:#64748b;display:block;">${t.description}</span>` : ''}
          <div style="display:flex;gap:6px;margin-top:3px;flex-wrap:wrap;">
            ${t.assignedTo ? `<span style="font-size:10px;color:#64748b;"><i class="fa-solid fa-user"></i> ${t.assignedTo}</span>` : ''}
            <span style="font-size:10px;font-weight:600;color:${pColor};">${t.priority}</span>
            ${t.dueDate ? `<span style="font-size:10px;color:${isOverdue ? '#dc2626' : '#64748b'};"><i class="fa-solid fa-calendar"></i> ${new Date(t.dueDate).toLocaleDateString()}${isOverdue ? ' (Overdue)' : ''}</span>` : ''}
            <span style="font-size:10px;padding:1px 6px;border-radius:50px;background:${t.status === 'Done' ? '#dcfce7' : t.status === 'In Progress' ? '#dbeafe' : '#f1f5f9'};color:${t.status === 'Done' ? '#16a34a' : t.status === 'In Progress' ? '#2563eb' : '#64748b'};">${t.status}</span>
          </div>
        </div>
        ${canEdit() ? `<i class="fa-solid fa-trash-can" style="color:#ef4444;font-size:11px;cursor:pointer;flex-shrink:0;" onclick="window.deleteTask('${t.id}')"></i>` : ''}
      </div>
    `;
  }).join("");
}

function getSelectedOrder() {
    const idx = parseInt(select.value);
    if (isNaN(idx)) return null;
    return orders[idx];
}

async function renderDetail(order) {
    if (!order) {
        document.getElementById("progressDetail").style.display = "none";
        return;
    }
    document.getElementById("progressDetail").style.display = "block";

    const progress = Number(order.progress) || 0;
    const statusClass = getStatusClass(order.status);
    const stage = getBuildStage(progress, order.status, order);

    document.getElementById("detailBoatImage").src = order.boatImage || "./images/boat2.jpg";
    document.getElementById("detailBoatName").textContent = order.boatName || "Boat";
    document.getElementById("detailCustomerName").textContent = "Customer: " + (order.customerName || "Unknown");
    const statusEl = document.getElementById("detailStatus");
    statusEl.textContent = order.status || "Pending";
    statusEl.className = "progress-status " + statusClass;

    const circle = document.getElementById("progressCircle");
    circle.style.background = "conic-gradient(#295dff 0% " + progress + "%, #e2e8f0 " + progress + "% 100%)";
    document.getElementById("progressPercent").textContent = progress + "%";
    document.getElementById("buildStage").textContent = stage;

    const isCustom = order.buildType === "custom";
    const tlItems = isCustom
        ? ["Design Submitted", "Under Review", "Approved", "Construction", "Delivery"]
        : ["Order Submitted", "Contract Signing", "Approved", "Construction", "Delivery"];

    const activeSteps = isCustom
        ? [0, (order.status === "Under Review" || order.status === "Approved" || progress >= 5) ? 1 : -1, (order.status === "Approved" || progress >= 10) ? 2 : -1, progress >= 25 ? 3 : -1, progress >= 100 ? 4 : -1]
        : [0, (order.status === "Pending Signing" || progress >= 5) ? 1 : -1, progress >= 10 ? 2 : -1, progress >= 25 ? 3 : -1, progress >= 100 ? 4 : -1];

    const timeline = document.getElementById("detailTimeline");
    timeline.innerHTML = tlItems.map((label, i) => {
        const cls = activeSteps[i] === i ? "active" : (activeSteps[i] >= 0 ? "" : "");
        return '<div class="tl-item ' + cls + '">' + label + '</div>';
    }).join("");

    document.getElementById("detailPrice").textContent = order.boatPrice || "N/A";
    document.getElementById("detailBuildTime").textContent = order.buildTime || "N/A";
    document.getElementById("detailPayment").textContent = order.paymentMethod || "N/A";
    document.getElementById("detailRemaining").textContent = "₱" + Number(order.remainingBalance || 0).toLocaleString();
    document.getElementById("detailBuildType").textContent = order.buildType === "custom" ? "Custom Build" : "Standard Build";

    const orderId = order.orderId;
    const workers = await getDBWorkers(orderId);

    const wContainer = document.getElementById("detailWorkers");
    if (workers.length === 0) {
        wContainer.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No workers assigned. Use "Manage Workers" below.</span>';
    } else {
        wContainer.innerHTML = workers.map(w => {
            const isActive = w.status === "Active";
            const phaseLabel = getMilestoneKeyLabel(w.phase);
            return '<span class="worker-chip' + (w.role ? ' role-' + w.role.toLowerCase().replace(/\s+/g, '-') : '') + '"><i class="fa-solid fa-user"></i>' + w.name +
                ' <span style="font-size:10px;color:#64748b;">— ' + (w.specialty || w.role) + '</span>' +
                (phaseLabel ? ' <span class="worker-phase-badge">' + phaseLabel + '</span>' : '') +
                ' <span class="worker-status-badge ' + (isActive ? 'active' : 'done') + '">' + (isActive ? 'Working' : 'Completed') + '</span>' +
                (isActive ? workerDueChip(w) : '') + '</span>';
        }).join("");
    }

    renderWorkers(orderId);
    renderPendingApprovals(order, workers);

    const updateBtn = document.getElementById("updateProgressBtn");
    const progressInput = document.getElementById("progressInput");
    const progressLockMsg = document.getElementById("progressLockMsg");
    if (canEdit() && order.status === "Approved" && progress < 100) {
      if (workers.length > 0) {
        updateBtn.style.display = "block";
        progressInput.style.display = "";
        progressLockMsg.style.display = "none";
        updateBtn.disabled = false;
      } else {
        updateBtn.style.display = "none";
        progressInput.style.display = "none";
        progressLockMsg.style.display = "block";
      }
    } else {
        updateBtn.style.display = "none";
        progressInput.style.display = "none";
        progressLockMsg.style.display = "none";
    }

    document.getElementById("tasksCard") ? document.getElementById("tasksCard").style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none" : null;
    if (order.status === "Approved" || order.status === "Completed") {
      loadTasks(order.orderId).then(() => renderTasks());
    } else {
      allTasks = [];
      const tc = document.getElementById("tasksList");
      if (tc) tc.innerHTML = "";
    }

    document.getElementById("workerManagerCard").style.display = (order.status === "Approved" && progress < 100) ? "block" : "none";

    document.getElementById("ganttCard") ? document.getElementById("ganttCard").style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none" : null;
    if (order.status === "Approved" || order.status === "Completed") {
      renderGanttChart(order);
    }

    document.getElementById("milestonesCard").style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    if (order.status === "Approved" || order.status === "Completed") {
      renderMilestones(order, workers.length === 0);
    }
    document.getElementById("activityLogCard").style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    if (order.status === "Approved" || order.status === "Completed") {
      renderActivityLog(order);
    }

    const cancelDiv = document.getElementById("cancelInfo");
    if (order.status === "Cancellation Requested") {
        cancelDiv.style.display = "block";
        cancelDiv.innerHTML = '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:14px;padding:14px;margin-top:12px;"><h4 style="font-size:13px;color:#dc2626;"><i class="fa-solid fa-clock"></i> Cancellation Requested</h4><p style="font-size:13px;color:#991b1b;margin-top:4px;">Reason: ' + (order.cancelReason || "N/A") + '</p><p style="font-size:13px;color:#991b1b;">Handle in Orders page.</p></div>';
    } else if (order.status === "Cancelled") {
        cancelDiv.style.display = "block";
        cancelDiv.innerHTML = '<div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:14px;padding:14px;margin-top:12px;"><h4 style="font-size:13px;color:#475569;"><i class="fa-solid fa-ban"></i> Order Cancelled</h4></div>';
    } else {
        cancelDiv.style.display = "none";
    }
    populateActivityPresets(order);

    const docCard = document.getElementById("documentsCard");
    const docSideCard = document.getElementById("documentsSideCard");
    if (docCard) docCard.style.display = (order.status === "Approved" || order.status === "Completed" || order.status === "Pending Signing") ? "block" : "none";
    if (docSideCard) docSideCard.style.display = (order.status === "Approved" || order.status === "Completed" || order.status === "Pending Signing") ? "block" : "none";
    await loadDocuments(order);

    const phaseCard = document.getElementById("phaseProgressCard");
    const photoCard = document.getElementById("progressPhotosCard");
    const photoSideCard = document.getElementById("photosSideCard");
    if (phaseCard) phaseCard.style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    if (photoCard) photoCard.style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    if (photoSideCard) photoSideCard.style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    renderPhaseProgress(order);
    await loadPhotos(order);

    const budgetCard = document.getElementById("budgetCard");
    const budgetSideCard = document.getElementById("budgetSideCard");
    if (budgetCard) budgetCard.style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    if (budgetSideCard) budgetSideCard.style.display = (order.status === "Approved" || order.status === "Completed") ? "block" : "none";
    const budgetInput = document.getElementById("budgetTotalInput");
    if (budgetInput && order.budgetInfo && order.budgetInfo.totalBudget) {
        budgetInput.value = order.budgetInfo.totalBudget;
    } else if (budgetInput) {
        budgetInput.value = parseFloat(String(order.boatPrice || "0").replace(/[^0-9.]/g, "")) || 0;
    }
    await loadBudget(order);

    // Delivery card — show when progress >= 70 or Completed
    const deliveryCard = document.getElementById("deliveryCard");
    if (deliveryCard) {
        if (order.progress >= 70 || order.status === "Completed") {
            deliveryCard.style.display = "block";
            const body = document.getElementById("deliveryCardBody");
            if (body) body.innerHTML = renderDeliveryCard(order);
        } else {
            deliveryCard.style.display = "none";
        }
    }
}

select.addEventListener("change", async function() {
    await renderDetail(getSelectedOrder());
    populateActivityPresets(getSelectedOrder());
});

document.getElementById("updateProgressBtn").addEventListener("click", async function() {
    if (!canEdit()) return;
    const order = getSelectedOrder();
    if (!order || order.status !== "Approved") return;

    const ww = await getDBWorkers(order.orderId);
    if (ww.length === 0) {
      showToast("Assign workers first before updating progress.", "warning");
      return;
    }

    const input = document.getElementById("progressInput");
    let progress = parseInt(input.value);
    if (isNaN(progress) || progress < 0) { alert("Enter a valid progress value."); return; }
    if (progress > 100) progress = 100;

    const maxProgress = getPaymentGate(order.paymentStep || 0);
    if (progress > maxProgress) {
      const needed = maxProgress === 0 ? "Downpayment" : maxProgress === 40 ? "Mid-Construction Payment" : "Final Payment";
      showToast("Cannot advance beyond " + maxProgress + "%. Complete " + needed + " first.", "warning");
      input.value = order.progress || 0;
      return;
    }

    if (progress >= 100 && Number(order.remainingBalance || 0) > 0) {
      showToast("Order must be fully paid before completion.", "warning");
      input.value = order.progress || 0;
      return;
    }

    const beforePhaseKey = phaseKeyAtProgress(order, Number(order.progress || 0));
    order.progress = progress;

    if (progress >= 100) {
        order.status = "Completed";
        order.orderPhase = "Completed";
    } else if (progress >= 70) {
        order.orderPhase = "Painting & Finishing";
    } else if (progress >= 45) {
        order.orderPhase = "Interior Installation";
    } else if (progress >= 25) {
        order.orderPhase = "Engine Assembly";
    } else {
        order.orderPhase = "Hull Construction";
    }

    const milestones = getOrderMilestones(order);
    const presets = getBoatMilestones(order.boatName);
    presets.forEach((p, i) => {
      if (i < milestones.length) {
        milestones[i].completed = progress >= p.percentage;
        if (milestones[i].completed && !milestones[i].completedDate) {
          milestones[i].completedDate = new Date().toISOString();
          addAutoActivityLog(order, milestones[i]);
        }
      }
    });
    order.milestones = milestones;

    await handleDbError(
      supabase.from("boat_orders").update({
        status: order.status, progress: order.progress, orderPhase: order.orderPhase,
        milestones: order.milestones, projectCompletedDate: order.projectCompletedDate || null
      }).eq("orderId", order.orderId),
      "Update progress"
    );

    const afterPhaseKey = phaseKeyAtProgress(order, progress);
    if (afterPhaseKey && afterPhaseKey !== beforePhaseKey && progress < 100) {
      const assign = await autoAssignForOrder(order.orderId);
      if (assign.ok && assign.count > 0) {
        showToast("Auto-assigned " + assign.count + " worker(s) for " + (getMilestoneKeyLabel(assign.phase) || afterPhaseKey) + ".", "success");
      } else {
        showToast("Phase changed to " + (getMilestoneKeyLabel(afterPhaseKey) || afterPhaseKey) + ". No available workers to auto-assign — assign manually.", "warning");
      }
    }

    await renderDetail(order);
    renderMilestones(order);
    renderActivityLog(order);
});

document.getElementById("addActivityBtn")?.addEventListener("click", () => {
    if (!canEdit()) return;
  const order = getSelectedOrder();
  if (!order) return;
  const title = document.getElementById("activityTitleInput").value.trim();
  const desc = document.getElementById("activityDescInput").value.trim();
  const personnel = document.getElementById("activityPersonnelInput").value.trim();
  const role = document.getElementById("activityRoleInput").value;
  if (!title) { alert("Please enter an update title."); return; }
  if (!desc) { alert("Please enter a description."); return; }
  if (!personnel) { alert("Please enter the personnel name."); return; }
  const log = getOrderActivityLog(order);
  log.push({
    title,
    description: desc,
    date: new Date().toISOString(),
    personnel,
    role
  });
  saveOrderActivityLog(order, log);
  document.getElementById("activityTitleInput").value = "";
  document.getElementById("activityDescInput").value = "";
  document.getElementById("activityPersonnelInput").value = "";
  renderActivityLog(order);
});

function populateActivityPresets(order) {
  const sel = document.getElementById("activityPresetSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Use a preset —</option>';
  if (!order || order.status !== "Approved") return;
  const presets = getActivityPresets(order.boatName);
  const phaseOrder = ["Design","Engineering","Marina","Construction","Outfitting","Systems","Winch","Sea Trial","Delivery"];
  phaseOrder.forEach(phase => {
    if (presets[phase] && presets[phase].length > 0) {
      const grp = document.createElement("optgroup");
      grp.label = phase;
      presets[phase].forEach((desc, i) => {
        const opt = document.createElement("option");
        opt.value = phase + "|" + i;
        opt.textContent = desc;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    }
  });
}

document.getElementById("activityPresetSelect")?.addEventListener("change", function() {
  const val = this.value;
  if (!val) return;
  const [phase, idx] = val.split("|");
  const order = getSelectedOrder();
  if (!order) return;
  const presets = getActivityPresets(order.boatName);
  if (presets[phase] && presets[phase][parseInt(idx)]) {
    document.getElementById("activityTitleInput").value = phase + " – " + presets[phase][parseInt(idx)];
    document.getElementById("activityDescInput").value = presets[phase][parseInt(idx)];
  }
});

/* =============================================
   DOCUMENT MANAGEMENT
   ============================================= */

let currentDocuments = [];

async function uploadDocument(orderId) {
  if (!canEdit()) return;
    const fileInput = document.getElementById("docFileInput");
    const nameInput = document.getElementById("docNameInput");
    const categorySelect = document.getElementById("docCategoryInput");

    const file = fileInput.files[0];
    const name = nameInput.value.trim();
    const category = categorySelect.value;

    if (!file) { showToast("Please select a file to upload.", "warning"); return; }
    if (!name) { showToast("Please enter a document name.", "warning"); return; }

    try {
        const filePath = "documents/" + orderId + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, file, { contentType: file.type, upsert: true });

        if (uploadError) {
            showToast("Upload failed: " + uploadError.message + ". Make sure the '" + STORAGE_BUCKET + "' bucket exists in Supabase Storage and is set to public.", "error");
            return;
        }

        const publicUrl = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(filePath).data?.publicUrl
            || supabaseUrl.replace(/\/+$/, "") + "/storage/v1/object/public/" + STORAGE_BUCKET + "/" + filePath;

        const doc = {
            id: "doc-" + Date.now(),
            name: name,
            category: category,
            fileUrl: publicUrl,
            filename: file.name,
            fileSize: file.size,
            uploadedBy: actorLabel(),
            uploadedAt: new Date().toISOString()
        };

        currentDocuments.push(doc);
        await saveDocuments(orderId);
        renderDocuments();
        renderDocumentsSide();
        fileInput.value = "";
        nameInput.value = "";
        showToast("Document uploaded successfully.", "success");
    } catch (err) {
        showToast("Upload error: " + err.message, "error");
    }
}

async function saveDocuments(orderId) {
    await handleDbError(
        supabase.from("boat_orders").update({ documents: currentDocuments, updatedAt: new Date().toISOString() }).eq("orderId", orderId),
        "Save documents"
    );
}

async function loadDocuments(order) {
    if (order && order.documents && Array.isArray(order.documents)) {
        currentDocuments = order.documents;
    } else {
        currentDocuments = [];
    }
    renderDocuments();
    renderDocumentsSide();
}

function renderDocuments() {
    const container = document.getElementById("documentsList");
    if (!container) return;
    if (currentDocuments.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">No documents uploaded yet.</span>';
        return;
    }
    container.innerHTML = currentDocuments.map(d => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
            <i class="fa-solid fa-file" style="color:#295dff;font-size:16px;"></i>
            <div style="flex:1;min-width:0;">
                <strong style="font-size:13px;color:#0f172a;display:block;">${d.name}</strong>
                <span style="font-size:11px;color:#64748b;">
                    ${d.category} ${d.fileSize ? '• ' + Math.round(d.fileSize / 1024) + ' KB' : ''} ${d.uploadedAt ? '• ' + new Date(d.uploadedAt).toLocaleDateString() : ''}
                </span>
            </div>
            <a href="${d.fileUrl}" target="_blank" style="color:#295dff;font-size:14px;padding:4px 8px;text-decoration:none;" title="View"><i class="fa-solid fa-eye"></i></a>
            ${canEdit() ? `<i class="fa-solid fa-trash-can" style="color:#ef4444;font-size:12px;cursor:pointer;padding:4px;" onclick="deleteDocument('${d.id}')" title="Delete"></i>` : ''}
        </div>
    `).join("");
}

function renderDocumentsSide() {
    const container = document.getElementById("documentsSideList");
    if (!container) return;
    const count = currentDocuments.length;
    const byCategory = {};
    currentDocuments.forEach(d => {
        byCategory[d.category] = (byCategory[d.category] || 0) + 1;
    });
    const categorySummary = Object.entries(byCategory).map(([cat, cnt]) =>
        `<span style="font-size:12px;">${cat}: <strong>${cnt}</strong></span>`
    ).join("");

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
            <span style="font-size:13px;color:#64748b;">Total Documents</span>
            <strong style="font-size:16px;color:#0f172a;">${count}</strong>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding-top:8px;border-top:1px solid #e2e8f0;">
            ${categorySummary || '<span style="font-size:12px;color:#94a3b8;">No documents</span>'}
        </div>
    `;
}

async function deleteDocument(docId) {
  if (!canEdit()) return;
    if (!confirm("Delete this document?")) return;
    const order = getSelectedOrder();
    if (!order) return;
    currentDocuments = currentDocuments.filter(d => d.id !== docId);
    await saveDocuments(order.orderId);
    renderDocuments();
    renderDocumentsSide();
}

window.deleteDocument = deleteDocument;

document.getElementById("uploadDocBtn")?.addEventListener("click", () => {
    const order = getSelectedOrder();
    if (!order) { showToast("Please select an order first.", "warning"); return; }
    uploadDocument(order.orderId);
});

/* =============================================
   PHASE PROGRESS BREAKDOWN
   ============================================= */

function renderPhaseProgress(order) {
    const container = document.getElementById("phaseProgressList");
    if (!container) return;
    if (!order || order.status !== "Approved") {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">Phase progress available once order is Approved.</span>';
        return;
    }

    const tl = BOAT_TIMELINE[order.boatName];
    if (!tl) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No timeline data for this boat type.</span>';
        return;
    }

    const progress = order.progress || 0;
    const phases = tl.phases.map(p => {
        const parts = p.split(" - ");
        return { name: parts[0], duration: parts[1] || "" };
    });
    const phaseCount = phases.length;
    const step = 100 / phaseCount;

    container.innerHTML = phases.map((phase, i) => {
        const phaseStart = i * step;
        const phaseEnd = (i + 1) * step;
        const isCompleted = progress >= phaseEnd;
        const isCurrent = !isCompleted && progress >= phaseStart;
        const phasePct = isCompleted ? 100 : isCurrent ? ((progress - phaseStart) / step) * 100 : 0;

        return `
        <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:28px;height:28px;border-radius:50%;background:${isCompleted ? '#22c55e' : isCurrent ? '#295dff' : '#e2e8f0'};display:flex;align-items:center;justify-content:center;color:white;font-size:12px;flex-shrink:0;">
                ${isCompleted ? '<i class="fa-solid fa-check"></i>' : isCurrent ? String(i + 1) : String(i + 1)}
            </div>
            <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <strong style="font-size:12px;color:${isCompleted ? '#16a34a' : isCurrent ? '#1d4ed8' : '#64748b'};">${phase.name}</strong>
                    <span style="font-size:11px;color:#64748b;">${isCompleted ? '100%' : isCurrent ? Math.round(phasePct) + '%' : '0%'}${phase.duration ? ' • ' + phase.duration : ''}</span>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${Math.round(phasePct)}%;background:${isCompleted ? '#22c55e' : '#295dff'};border-radius:3px;transition:width 0.3s;"></div>
                </div>
            </div>
        </div>`;
    }).join("");
}

/* =============================================
   PROGRESS PHOTOS
   ============================================= */

let currentPhotos = [];

async function uploadProgressPhoto(orderId) {
  if (!canEdit()) return;
    const fileInput = document.getElementById("progressPhotoInput");
    const captionInput = document.getElementById("progressPhotoCaption");
    const file = fileInput.files[0];
    const caption = captionInput.value.trim();

    if (!file) { showToast("Please select a photo to upload.", "warning"); return; }

    try {
        const filePath = "photos/" + orderId + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, file, { contentType: file.type, upsert: true });

        if (uploadError) {
            showToast("Upload failed: " + uploadError.message + ". Make sure the '" + STORAGE_BUCKET + "' bucket exists in Supabase Storage and is set to public.", "error");
            return;
        }

        const publicUrl = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(filePath).data?.publicUrl
            || supabaseUrl.replace(/\/+$/, "") + "/storage/v1/object/public/" + STORAGE_BUCKET + "/" + filePath;

        const photo = {
            id: "photo-" + Date.now(),
            caption: caption || "Progress update",
            fileUrl: publicUrl,
            filename: file.name,
            uploadedAt: new Date().toISOString()
        };

        currentPhotos.push(photo);
        await savePhotos(orderId);
        renderPhotos();
        renderPhotosSide();
        fileInput.value = "";
        captionInput.value = "";
        showToast("Progress photo uploaded.", "success");
    } catch (err) {
        showToast("Upload error: " + err.message, "error");
    }
}

async function savePhotos(orderId) {
    await handleDbError(
        supabase.from("boat_orders").update({ progressPhotos: currentPhotos, updatedAt: new Date().toISOString() }).eq("orderId", orderId),
        "Save photos"
    );
}

async function loadPhotos(order) {
    if (order && order.progressPhotos && Array.isArray(order.progressPhotos)) {
        currentPhotos = order.progressPhotos;
    } else {
        currentPhotos = [];
    }
    renderPhotos();
    renderPhotosSide();
}

function renderPhotos() {
    const container = document.getElementById("progressPhotosGrid");
    if (!container) return;
    if (currentPhotos.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;grid-column:1/-1;">No progress photos yet.</span>';
        return;
    }
    container.innerHTML = currentPhotos.map(p => `
        <div style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;position:relative;">
            <img src="${p.fileUrl}" alt="${p.caption}" style="width:100%;height:100px;object-fit:cover;display:block;cursor:pointer;" onclick="window.open('${p.fileUrl}','_blank')">
            <div style="padding:4px 6px;font-size:10px;color:#64748b;background:white;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">${p.caption} ${p.uploadedAt ? '• ' + new Date(p.uploadedAt).toLocaleDateString() : ''}</div>
            ${canEdit() ? `<i class="fa-solid fa-trash-can" style="position:absolute;top:4px;right:4px;color:#ef4444;font-size:11px;cursor:pointer;background:rgba(255,255,255,0.9);padding:4px;border-radius:4px;" onclick="deleteProgressPhoto('${p.id}')" title="Delete"></i>` : ''}
        </div>
    `).join("");
}

function renderPhotosSide() {
    const container = document.getElementById("photosSideGrid");
    if (!container) return;
    if (currentPhotos.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:12px;text-align:center;grid-column:1/-1;">No photos yet.</span>';
        return;
    }
    container.innerHTML = currentPhotos.map(p => `
        <img src="${p.fileUrl}" alt="${p.caption}" style="width:100%;height:70px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid #e2e8f0;" onclick="window.open('${p.fileUrl}','_blank')" title="${p.caption}">
    `).join("");
}

async function deleteProgressPhoto(photoId) {
  if (!canEdit()) return;
    if (!confirm("Delete this photo?")) return;
    const order = getSelectedOrder();
    if (!order) return;
    currentPhotos = currentPhotos.filter(p => p.id !== photoId);
    await savePhotos(order.orderId);
    renderPhotos();
    renderPhotosSide();
}

window.deleteProgressPhoto = deleteProgressPhoto;

document.getElementById("uploadProgressPhotoBtn")?.addEventListener("click", () => {
    const order = getSelectedOrder();
    if (!order) { showToast("Please select an order first.", "warning"); return; }
    uploadProgressPhoto(order.orderId);
});

/* =============================================
   BUDGET & RESOURCES
   ============================================= */

function getDefaultBudgetInfo(order) {
    const price = parseFloat(String(order.boatPrice || "0").replace(/[^0-9.]/g, "")) || 0;
    return {
        totalBudget: price,
        expenses: []
    };
}

async function loadBudget(order) {
    if (!order.budgetInfo || typeof order.budgetInfo !== "object" || !order.budgetInfo.expenses) {
        order.budgetInfo = getDefaultBudgetInfo(order);
    }
    renderBudgetBar(order);
    renderExpenseList(order);
    renderBudgetSide(order);
}

function renderBudgetBar(order) {
    const container = document.getElementById("budgetBarContainer");
    if (!container) return;
    const bi = order.budgetInfo || getDefaultBudgetInfo(order);
    const total = bi.totalBudget || 0;
    const expenses = bi.expenses || [];
    const spent = sumCountedExpenses(expenses);
    const pending = sumPendingExpenses(expenses);
    const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;

    if (total > 0) {
        container.style.display = "block";
        document.getElementById("budgetSpentLabel").textContent = "Spent: ₱" + spent.toLocaleString();
        document.getElementById("budgetRemainingLabel").textContent = "Remaining: ₱" + Math.max(0, total - spent).toLocaleString();
        document.getElementById("budgetBarFill").style.width = pct + "%";
        document.getElementById("budgetPctLabel").textContent = Math.round(pct) + "% spent";
        document.getElementById("budgetTotalLabel").textContent = "of ₱" + total.toLocaleString();
    } else {
        container.style.display = "none";
    }

    const pendingLabel = document.getElementById("budgetPendingLabel");
    if (pendingLabel) {
        if (pending > 0) {
            pendingLabel.style.display = "block";
            pendingLabel.textContent = "+ ₱" + pending.toLocaleString() + " pending approval (not counted as spent)";
        } else {
            pendingLabel.style.display = "none";
        }
    }
}

function renderExpenseList(order) {
    const container = document.getElementById("expenseList");
    if (!container) return;
    const bi = order.budgetInfo || getDefaultBudgetInfo(order);
    const expenses = bi.expenses || [];

    if (expenses.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;text-align:center;padding:12px;">No expenses recorded yet.</span>';
        return;
    }

    const categoryColors = {
        Materials: "#dbeafe", Labor: "#fef3c7", Equipment: "#e0e7ff",
        Transport: "#fce7f3", Permits: "#d1fae5", Other: "#f1f5f9"
    };
    const categoryTextColors = {
        Materials: "#1e40af", Labor: "#92400e", Equipment: "#3730a3",
        Transport: "#9d174d", Permits: "#065f46", Other: "#475569"
    };

    const statusStyle = (s) => s === "approved"
        ? "background:#dcfce7;color:#166534"
        : s === "rejected"
            ? "background:#fee2e2;color:#991b1b"
            : "background:#fef3c7;color:#92400e";
    const statusLabel = (s) => s === "approved" ? "Approved" : s === "rejected" ? "Rejected" : "Pending";

    container.innerHTML = expenses.map((e, i) => {
        const st = e.status || "approved";
        const isRejected = st === "rejected";
        const isPending = st === "pending";
        return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isPending ? '#fffbeb' : isRejected ? '#fef2f2' : '#f8fafc'};border:1px solid ${isPending ? '#fcd34d' : isRejected ? '#fecaca' : '#e2e8f0'};border-radius:10px;">
            <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:50px;background:${categoryColors[e.category] || '#f1f5f9'};color:${categoryTextColors[e.category] || '#475569'};white-space:nowrap;">${e.category || 'Other'}</span>
            <div style="flex:1;min-width:0;">
                <strong style="font-size:12px;color:#0f172a;display:block;text-decoration:${isRejected ? 'line-through' : 'none'};">${e.description || ''}</strong>
                <span style="font-size:11px;color:#64748b;">${e.date ? new Date(e.date).toLocaleDateString() : ''}${e.submittedBy ? ' · by ' + e.submittedBy : ''}</span>
            </div>
            <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:50px;white-space:nowrap;${statusStyle(st)};">${statusLabel(st)}</span>
            <strong style="font-size:13px;color:${isPending ? '#b45309' : '#dc2626'};${isPending ? 'text-decoration:underline dashed;' : ''}">-₱${(parseFloat(e.amount) || 0).toLocaleString()}</strong>
            ${isPending && canManageMoney() ? `<button onclick="reviewExpense(${i},'approved')" title="Approve" style="border:none;background:#22c55e;color:white;border-radius:6px;padding:4px 7px;cursor:pointer;font-size:11px;"><i class="fa-solid fa-check"></i></button><button onclick="reviewExpense(${i},'rejected')" title="Reject" style="border:none;background:#ef4444;color:white;border-radius:6px;padding:4px 7px;cursor:pointer;font-size:11px;"><i class="fa-solid fa-xmark"></i></button>` : ''}
            ${canManageMoney() ? `<i class="fa-solid fa-trash-can" style="color:#94a3b8;font-size:12px;cursor:pointer;padding:4px;" onclick="deleteExpense(${i})" title="Delete"></i>` : ''}
        </div>
    `;
    }).join("");
}

function renderBudgetSide(order) {
    const container = document.getElementById("budgetSideContent");
    if (!container) return;
    const bi = order.budgetInfo || getDefaultBudgetInfo(order);
    const total = bi.totalBudget || 0;
    const expenses = bi.expenses || [];
    const spent = sumCountedExpenses(expenses);
    const pending = sumPendingExpenses(expenses);

    if (!total) {
        container.innerHTML = '<span style="font-size:12px;color:#94a3b8;">No budget set.</span>';
        return;
    }

    const pct = Math.min(100, (spent / total) * 100);
    const remaining = Math.max(0, total - spent);
    const statusColor = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e";

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span style="color:#64748b;">Budget</span>
            <strong style="color:#0f172a;">₱${total.toLocaleString()}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span style="color:#64748b;">Spent</span>
            <strong style="color:#dc2626;">₱${spent.toLocaleString()}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span style="color:#64748b;">Remaining</span>
            <strong style="color:${statusColor};">₱${remaining.toLocaleString()}</strong>
        </div>
        <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:2px;">
            <div style="height:100%;width:${pct}%;background:${statusColor};border-radius:3px;transition:width 0.3s;"></div>
        </div>
        <span style="font-size:11px;color:#64748b;text-align:center;">${Math.round(pct)}% of budget utilized</span>
        ${pending > 0 ? `<span style="font-size:11px;color:#b45309;text-align:center;display:block;">+ ₱${pending.toLocaleString()} pending approval</span>` : ''}
    `;
}

async function setBudget() {
  if (!canManageMoney()) return;
    const order = getSelectedOrder();
    if (!order) { showToast("Please select an order first.", "warning"); return; }
    const input = document.getElementById("budgetTotalInput");
    const val = parseFloat(input.value);
    if (isNaN(val) || val <= 0) { showToast("Enter a valid budget amount.", "warning"); return; }

    if (!order.budgetInfo || typeof order.budgetInfo !== "object") {
        order.budgetInfo = { expenses: [] };
    }
    order.budgetInfo.totalBudget = val;

    await handleDbError(
        supabase.from("boat_orders").update({ budgetInfo: order.budgetInfo, updatedAt: new Date().toISOString() }).eq("orderId", order.orderId),
        "Set budget"
    );
    showToast("Budget set to ₱" + val.toLocaleString(), "success");
    renderBudgetBar(order);
    renderBudgetSide(order);
}

async function addExpense() {
  if (!canLogExpense()) return;
    const order = getSelectedOrder();
    if (!order) { showToast("Please select an order first.", "warning"); return; }

    const category = document.getElementById("expenseCategoryInput").value;
    const desc = document.getElementById("expenseDescInput").value.trim();
    const amount = parseFloat(document.getElementById("expenseAmountInput").value);

    if (!desc) { showToast("Enter an expense description.", "warning"); return; }
    if (isNaN(amount) || amount <= 0) { showToast("Enter a valid expense amount.", "warning"); return; }

    if (!order.budgetInfo || typeof order.budgetInfo !== "object") {
        order.budgetInfo = { totalBudget: 0, expenses: [] };
    }
    if (!order.budgetInfo.expenses) order.budgetInfo.expenses = [];

    const autoApproved = isAdmin();
    order.budgetInfo.expenses.push({
        category, description: desc,
        amount: amount,
        date: new Date().toISOString(),
        status: autoApproved ? "approved" : "pending",
        submittedBy: actorLabel(),
        reviewedBy: autoApproved ? "Admin" : null,
        reviewedAt: autoApproved ? new Date().toISOString() : null
    });

    await handleDbError(
        supabase.from("boat_orders").update({ budgetInfo: order.budgetInfo, updatedAt: new Date().toISOString() }).eq("orderId", order.orderId),
        "Add expense"
    );
    document.getElementById("expenseDescInput").value = "";
    document.getElementById("expenseAmountInput").value = "";
    showToast(autoApproved ? "Expense added and approved." : "Expense submitted for admin approval.", "success");
    renderBudgetBar(order);
    renderExpenseList(order);
    renderBudgetSide(order);
}

async function reviewExpense(index, decision) {
  if (!canManageMoney()) return;
  const order = getSelectedOrder();
  if (!order || !order.budgetInfo || !order.budgetInfo.expenses) return;
  const expense = order.budgetInfo.expenses[index];
  if (!expense) return;

  const isReject = decision === "rejected";
  if (isReject && !confirm('Reject "' + (expense.description || "this expense") + '"? It stays in the list as Rejected for the record.')) return;

  expense.status = isReject ? "rejected" : "approved";
  expense.reviewedBy = "Admin";
  expense.reviewedAt = new Date().toISOString();

  await handleDbError(
    supabase.from("boat_orders").update({ budgetInfo: order.budgetInfo, updatedAt: new Date().toISOString() }).eq("orderId", order.orderId),
    isReject ? "Reject expense" : "Approve expense"
  );
  showToast(isReject ? "Expense rejected." : "Expense approved.", "success");
  renderBudgetBar(order);
  renderExpenseList(order);
  renderBudgetSide(order);
}

window.reviewExpense = reviewExpense;

async function deleteExpense(index) {
  if (!canManageMoney()) return;
    if (!confirm("Delete this expense?")) return;
    const order = getSelectedOrder();
    if (!order) return;
    if (!order.budgetInfo || !order.budgetInfo.expenses) return;

    order.budgetInfo.expenses.splice(index, 1);
    await handleDbError(
        supabase.from("boat_orders").update({ budgetInfo: order.budgetInfo, updatedAt: new Date().toISOString() }).eq("orderId", order.orderId),
        "Delete expense"
    );
    renderBudgetBar(order);
    renderExpenseList(order);
    renderBudgetSide(order);
}

window.deleteExpense = deleteExpense;

document.getElementById("setBudgetBtn")?.addEventListener("click", setBudget);
document.getElementById("addExpenseBtn")?.addEventListener("click", addExpense);

window.toggleMilestone = toggleMilestone;
window.removeWorker = removeWorker;
window.updateTaskStatus = updateTaskStatus;
window.deleteTask = deleteTask;

document.getElementById("addTaskBtn")?.addEventListener("click", () => {
  const order = getSelectedOrder();
  if (order) addTask(order.orderId);
});

document.getElementById("tasksFilter")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".task-filter-btn");
  if (btn) setTaskFilter(btn.dataset.filter);
});

/* ============ DELIVERY MANAGEMENT ============ */

function fmtDate(dateStr) {
    if (!dateStr || dateStr === 'To be determined') return 'Not set';
    try { return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch { return dateStr; }
}

function fmtCurrency(val) {
    return '₱' + (parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function getDeliveryStatus(order) {
    const di = order.deliveryInfo || {};
    if (di.deliveryStatus) return di.deliveryStatus;
    return 'Preparing for Delivery';
}

function isDelayed(order) {
    const di = order.deliveryInfo || {};
    if (di.delayDays && di.delayDays > 0) return true;
    if (di.actualDeliveryDate && di.committedDeliveryDate) {
        return new Date(di.actualDeliveryDate) > new Date(di.committedDeliveryDate);
    }
    return false;
}

function calcDeliveryDelay(boatPrice, committedDate, actualDate) {
    if (!committedDate || !actualDate) return { days: 0, penalty: 0, percent: 0 };
    const c = new Date(committedDate), a = new Date(actualDate);
    if (a <= c) return { days: 0, penalty: 0, percent: 0 };
    const days = Math.ceil((a - c) / (1000 * 60 * 60 * 24));
    const price = parseInt(String(boatPrice || '0').replace(/[^0-9]/g, '')) || 0;
    let pct = 0;
    if (days >= 1 && days <= 7) pct = 1;
    else if (days >= 8 && days <= 14) pct = 2;
    else if (days >= 15 && days <= 30) pct = 5;
    else if (days > 30) pct = 8;
    return { days, penalty: Math.round(price * (pct / 100)), percent: pct };
}

function renderDeliveryCard(order) {
    const di = order.deliveryInfo || {};
    const status = getDeliveryStatus(order);
    const delayed = isDelayed(order);
    const delayInfo = calcDeliveryDelay(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate);
    const progress = di.deliveryProgress || 0;
    const badgeClass = status === 'Preparing for Delivery' ? 'preparing' : status === 'Ready for Delivery' ? 'ready' : status === 'In Transit' ? 'transit' : 'delivered';
    const cardStatusClass = delayed && status !== 'Delivered' ? 'status-delayed' : 'status-' + (status === 'Preparing for Delivery' ? 'preparing' : status === 'Ready for Delivery' ? 'ready' : status === 'In Transit' ? 'transit' : 'delivered');
    return `
    <div class="delivery-card ${cardStatusClass}" style="margin:0;box-shadow:none;padding:0;border-left:none;">
        <div class="card-header">
            <div class="card-badges">
                <span class="status-badge ${badgeClass}">${status}</span>
                ${delayed ? `<span class="delay-badge"><i class="fas fa-exclamation-triangle"></i> ${delayInfo.days}d late</span>` : ''}
            </div>
            ${canEdit() ? '<button class="manage-btn" onclick="openDeliveryModal()" style="padding:8px 16px;font-size:12px;border:none;border-radius:12px;background:#356cff;color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="fas fa-edit"></i> Manage</button>' : ''}
        </div>
        <div class="card-details" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
            <div class="detail-item"><h4>Committed Date</h4><p>${fmtDate(di.committedDeliveryDate)}</p></div>
            <div class="detail-item"><h4>Actual Delivery</h4><p>${fmtDate(di.actualDeliveryDate)}</p></div>
            <div class="detail-item"><h4>Location</h4><p>${di.deliveryLocation || 'TBC'}</p></div>
            <div class="detail-item"><h4>Contact</h4><p>${di.contactPerson || 'TBA'}</p></div>
            <div class="detail-item"><h4>Sea Trial</h4><p>${di.seaTrialResults || 'Pending'}</p></div>
        </div>
        <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span style="color:#64748b;">Delivery Progress</span>
                <span style="font-weight:700;">${progress}%</span>
            </div>
            <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${progress}%;background:${delayed ? 'linear-gradient(90deg,#ef4444,#dc2626)' : 'linear-gradient(90deg,#356cff,#295dff)'};border-radius:3px;transition:width .4s;"></div>
            </div>
        </div>
        ${delayed ? `
        <div class="delay-info-box">
            <h4><i class="fas fa-exclamation-triangle"></i> Delivery Delay</h4>
            <div class="delay-details">
                <div class="dd-item"><strong>Days:</strong> ${delayInfo.days}d</div>
                <div class="dd-item"><strong>Rate:</strong> ${delayInfo.percent}%</div>
                <div class="dd-item"><strong>Discount:</strong> ${fmtCurrency(delayInfo.penalty)}</div>
            </div>
            ${di.delayReason ? `<div style="margin-top:8px;font-size:12px;color:#991b1b;"><strong>Reason:</strong> ${di.delayReason}</div>` : ''}
        </div>` : ''}
        ${status === 'Delivered' && order.ratingInfo && order.ratingInfo.rating ? `
        <div class="delay-info-box" style="background:#fffbeb;border-color:#fde68a;">
            <h4 style="color:#92400e;"><i class="fas fa-star"></i> Customer Rating</h4>
            <div style="display:flex;gap:4px;margin-bottom:6px;">
                ${[1,2,3,4,5].map(i => '<i class="fas fa-star" style="color:' + (i <= order.ratingInfo.rating ? '#f59e0b' : '#d1d5db') + ';font-size:18px;"></i>').join('')}
            </div>
            ${order.ratingInfo.review ? `<p style="font-size:13px;color:#78350f;font-style:italic;">"${order.ratingInfo.review}"</p>` : ''}
            <p style="font-size:11px;color:#a16207;margin-top:4px;">${order.ratingInfo.customerName || 'Customer'} • ${new Date(order.ratingInfo.createdAt).toLocaleDateString()}</p>
        </div>` : ''}
    </div>`;
}

function dateToISO(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
}

window.openDeliveryModal = function() {
    const order = getSelectedOrder();
    if (!order) return;
    const di = order.deliveryInfo || {};
    const status = getDeliveryStatus(order);
    const delayed = isDelayed(order);
    const delayInfo = calcDeliveryDelay(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate);
    const body = document.getElementById('deliveryModalBody');
    if (!body) return;
    body.innerHTML = `
    <div class="modal-header">
        <div class="modal-header-icon"><i class="fas fa-truck"></i></div>
        <div class="modal-header-info">
            <h3>${order.boatName || 'Unknown'} — ${order.customerName || 'N/A'}</h3>
            <p>${order.orderId || ''} | Price: ${fmtCurrency(order.boatPrice)}</p>
        </div>
    </div>
    <div class="modal-section">
        <h4><i class="fas fa-truck-fast"></i> Delivery Status</h4>
        <div class="form-group">
            <label>Status</label>
            <select id="modalStatus">
                <option value="Preparing for Delivery" ${status === 'Preparing for Delivery' ? 'selected' : ''}>Preparing for Delivery</option>
                <option value="Ready for Delivery" ${status === 'Ready for Delivery' ? 'selected' : ''}>Ready for Delivery</option>
                <option value="In Transit" ${status === 'In Transit' ? 'selected' : ''}>In Transit</option>
                <option value="Delivered" ${status === 'Delivered' ? 'selected' : ''}>Delivered</option>
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Sea Trial Results</label>
                <select id="modalSeaTrial">
                    <option value="Pending" ${di.seaTrialResults === 'Pending' || !di.seaTrialResults ? 'selected' : ''}>Pending</option>
                    <option value="Passed" ${di.seaTrialResults === 'Passed' ? 'selected' : ''}>Passed</option>
                    <option value="Failed" ${di.seaTrialResults === 'Failed' ? 'selected' : ''}>Failed</option>
                    <option value="Conditional" ${di.seaTrialResults === 'Conditional' ? 'selected' : ''}>Conditional</option>
                </select>
            </div>
            <div class="form-group">
                <label>Delivery Progress (%)</label>
                <input type="range" id="modalProgress" min="0" max="100" value="${di.deliveryProgress || 0}" style="width:100%;margin-top:8px;" oninput="document.getElementById('progressValue').textContent=this.value+'%'">
                <span id="progressValue" style="font-size:13px;font-weight:700;">${di.deliveryProgress || 0}%</span>
            </div>
        </div>
    </div>
    <div class="modal-section">
        <h4><i class="fas fa-calendar-alt"></i> Dates</h4>
        <div class="form-row">
            <div class="form-group">
                <label>Committed Delivery Date</label>
                <input type="date" id="modalCommittedDate" value="${di.committedDeliveryDate ? di.committedDeliveryDate.split('T')[0] : ''}" onchange="updateActualDateMin()">
            </div>
            <div class="form-group">
                <label>Actual Delivery Date</label>
                <input type="date" id="modalActualDate" value="${di.actualDeliveryDate ? di.actualDeliveryDate.split('T')[0] : ''}" onchange="previewPenalty()">
            </div>
        </div>
        <div id="penaltyPreview"></div>
    </div>
    <div class="modal-section">
        <h4><i class="fas fa-location-dot"></i> Delivery Details</h4>
        <div class="form-row">
            <div class="form-group">
                <label>Delivery Location</label>
                <input type="text" id="modalLocation" value="${di.deliveryLocation || ''}" placeholder="Address or port">
            </div>
            <div class="form-group">
                <label>Contact Person</label>
                <input type="text" id="modalContact" value="${di.contactPerson || ''}" placeholder="Customer name or contact">
            </div>
        </div>
    </div>
    <div class="modal-section">
        <h4><i class="fas fa-sticky-note"></i> Delay Info & Notes</h4>
        <div class="form-group">
            <label>Delay Reason</label>
            <textarea id="modalDelayReason" placeholder="Explain reason for delay...">${di.delayReason || ''}</textarea>
        </div>
        <div class="form-group">
            <label>Admin Notes</label>
            <textarea id="modalNotes" placeholder="Internal notes...">${di.deliveryNotes || ''}</textarea>
        </div>
    </div>
    <button class="save-btn" id="saveDeliveryBtn" onclick="saveDelivery()"><i class="fas fa-save"></i> Save Delivery Details</button>`;
    document.getElementById('deliveryModal').classList.add('show');
    previewPenalty();
};

window.updateActualDateMin = function() {
    const committed = document.getElementById('modalCommittedDate');
    const actual = document.getElementById('modalActualDate');
    if (committed && actual) {
        actual.min = committed.value;
        if (actual.value && actual.value < committed.value) actual.value = committed.value;
    }
};

window.previewPenalty = function() {
    const committed = document.getElementById('modalCommittedDate')?.value;
    const actual = document.getElementById('modalActualDate')?.value;
    const previewEl = document.getElementById('penaltyPreview');
    if (!previewEl) return;
    if (!committed || !actual) { previewEl.innerHTML = ''; return; }
    const a = new Date(actual), c = new Date(committed);
    if (a <= c) {
        previewEl.innerHTML = '<div class="penalty-preview penalty-none"><h5><i class="fas fa-check-circle"></i> No Delay</h5><div style="font-size:13px;">Delivery is on time. No penalty applies.</div></div>';
        return;
    }
    const diffMs = a - c, days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const order = getSelectedOrder();
    const price = parseInt(String(order?.boatPrice || '0').replace(/[^0-9]/g, '')) || 0;
    let pct = 0;
    if (days >= 1 && days <= 7) pct = 1;
    else if (days >= 8 && days <= 14) pct = 2;
    else if (days >= 15 && days <= 30) pct = 5;
    else if (days > 30) pct = 8;
    const penalty = Math.round(price * (pct / 100));
    previewEl.innerHTML = '<div class="penalty-preview"><h5><i class="fas fa-exclamation-triangle"></i> Delay Penalty Preview</h5><div class="penalty-amount">' + fmtCurrency(penalty) + '</div><div class="penalty-info">' + days + ' day(s) late | ' + pct + '% of boat price (' + fmtCurrency(price) + ')</div></div>';
};

window.saveDelivery = async function() {
    if (!canEdit()) return;
    const order = getSelectedOrder();
    if (!order) return;
    const btn = document.getElementById('saveDeliveryBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    const data = {
        deliveryStatus: document.getElementById('modalStatus').value,
        seaTrialResults: document.getElementById('modalSeaTrial').value,
        deliveryProgress: parseInt(document.getElementById('modalProgress').value) || 0,
        committedDeliveryDate: document.getElementById('modalCommittedDate').value || '',
        actualDeliveryDate: document.getElementById('modalActualDate').value || '',
        deliveryLocation: document.getElementById('modalLocation').value || '',
        contactPerson: document.getElementById('modalContact').value || '',
        delayReason: document.getElementById('modalDelayReason').value || '',
        deliveryNotes: document.getElementById('modalNotes').value || ''
    };
    if (data.deliveryStatus === 'Delivered') {
        data.deliveryConfirmed = true;
        data.deliveryProgress = 100;
    }
    const oldInfo = order.deliveryInfo || {};
    const newInfo = { ...oldInfo };
    Object.keys(data).forEach(k => { newInfo[k] = data[k]; });
    const result = calcDeliveryDelay(order.boatPrice, data.committedDeliveryDate, data.actualDeliveryDate);
    newInfo.delayDays = result.days;
    newInfo.delayPenalty = result.penalty;
    newInfo.delayPenaltyPercent = result.percent;
    const { error } = await supabase
        .from('boat_orders')
        .update({ deliveryInfo: newInfo, updatedAt: new Date().toISOString() })
        .eq('orderId', order.orderId);
    if (error) {
        showToast('Error saving delivery: ' + error.message, 'error');
    } else {
        order.deliveryInfo = newInfo;
        showToast('Delivery details saved successfully!', 'success');
        closeDeliveryModal();
        renderDetail(order);
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Delivery Details';
};

window.closeDeliveryModal = function() {
    document.getElementById('deliveryModal').classList.remove('show');
};

/* ============ WORKER ACCOUNTS & REGISTRATIONS ============ */

function escWorkerHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

window.switchProgressTab = function(tab) {
    return;
};

async function loadWorkerAccounts() {
    return;
}

async function loadRegistrations() {
    return;
}

window.approveRegistration = async function(id) { return; };
window.rejectRegistration = async function(id) { return; };
window.showCreateWorkerModal = function() { return; };
window.closeCreateWorkerModal = function() { return; };
window.submitCreateWorker = async function() { return; };

(async function init() {
    const token = await ensureSession();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
    if (!profile || !["admin", "manager"].includes(profile.role)) { window.location.href = "login.html"; return; }
    window.currentRole = profile.role;
    applyRoleLock();

    await ensureWorkerRegistry();
    await backfillRegistry();
    const result = await handleDbError(
        supabase.from("boat_orders").select("*").order("createdAt", { ascending: false }),
        "Load orders"
    );
    orders = (result && !result.error ? result.data : []) || [];
    populateSelect();
    await populateWorkerSelect();
    await renderMasterWorkers();
    if (select.options.length > 1) {
        for (var i = 1; i < select.options.length; i++) {
            if (!select.options[i].disabled && select.options[i].value !== "") {
                select.value = select.options[i].value;
                break;
            }
        }
        await renderDetail(getSelectedOrder());
    }
    loadRegistrations();
})();
