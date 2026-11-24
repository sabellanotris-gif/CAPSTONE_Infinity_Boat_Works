// ============ DELIVERY PIPELINE PAGE ============
// Admin + Manager. Lists every order admitted to delivery — i.e. the customer
// has confirmed their delivery details, or staff already moved the delivery
// ahead. Pending customer confirmation does not show here.

import { supabase } from "./supabase.js";
import {
  DELIVERY_TERMS,
  getDeliveryStatus,
  isDelayed,
  calcDeliveryDelay,
  fmtDate,
  fmtCurrency,
  fmtTime,
  openDeliveryModal,
  canManageDelivery,
  registerDeliveryOrder,
  canViewDelivery,
} from "./delivery-shared.js?v=6";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

const STATUS_ORDER = ["Preparing for Delivery", "Ready for Delivery", "In Transit", "Delivered"];
const FILTER_STATUS = {
  all: "all",
  preparing: "Preparing for Delivery",
  ready: "Ready for Delivery",
  transit: "In Transit",
  delivered: "Delivered",
  overdue: "Overdue",
};
const STATUS_ICONS = {
  "Preparing for Delivery": "fa-box",
  "Ready for Delivery": "fa-screwdriver-wrench",
  "In Transit": "fa-ship",
  "Delivered": "fa-circle-check",
  "Overdue": "fa-triangle-exclamation",
};

let allOrders = [];
let currentFilter = "all";
let searchQuery = "";

function statusClass(status) {
  return status === "Preparing for Delivery" ? "preparing"
    : status === "Ready for Delivery" ? "ready"
    : status === "In Transit" ? "transit"
    : status === "Overdue" ? "overdue"
    : "delivered";
}

// Option B: an order enters the admin/manager delivery pipeline only after the
// customer confirms their delivery details (see customer-confirm). Staff-set
// in-flight statuses (In Transit / Delivered / etc.) still show for backward
// compatibility; a bare high-progress or Completed order does not.
function isInDelivery(order) {
  const di = order.deliveryInfo || {};
  return di.customerConfirmed === true
    || (di.deliveryStatus && di.deliveryStatus !== "Preparing for Delivery");
}

// Overdue is exclusive: a delayed, not-yet-delivered order leaves its status
// column and appears only in Overdue. Delivered-late orders keep the existing
// Delivered behaviour.
function isOverdue(order) {
  return isDelayed(order) && getDeliveryStatus(order) !== "Delivered";
}

function boardStatus(order) {
  return isOverdue(order) ? "Overdue" : getDeliveryStatus(order);
}

function boatImageFor(order) {
  const customPreview = order.buildType === "custom" && order.customConfig?.boatPreviewImage;
  return customPreview || order.boatImage || "./images/boat2.jpg";
}

function searchableText(order) {
  const di = order.deliveryInfo || {};
  const parts = [
    order.boatName,
    order.customerName,
    order.orderId,
    order.customerEmail,
    order.boatType,
    di.deliveryLocation,
    di.confirmLocation,
    di.contactPerson,
    di.confirmContact,
    di.deliveryNotes,
  ];
  if (Array.isArray(di.snagList)) {
    parts.push(...di.snagList.map((snag) => snag && snag.title));
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function visibleOrders() {
  const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return allOrders.filter((o) => {
    if (currentFilter !== "all" && boardStatus(o) !== FILTER_STATUS[currentFilter]) return false;
    if (terms.length) {
      const hay = searchableText(o);
      if (!terms.every((term) => hay.includes(term))) return false;
    }
    return true;
  });
}

function seaTrialBadge(seaTrial) {
  const value = seaTrial || "Pending";
  const cls = value === "Passed" ? "passed" : value === "Failed" ? "failed" : value === "Conditional" ? "conditional" : "pending";
  return `<span class="sea-trial ${cls}">${value}</span>`;
}

function esc(v) {
  return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cardHtml(order) {
  const di = order.deliveryInfo || {};
  // Register the order so the shared manage modal can look it up.
  registerDeliveryOrder(order);
  const status = getDeliveryStatus(order);
  const delayed = isDelayed(order);
  const overdue = isOverdue(order);
  const statusIcon = STATUS_ICONS[boardStatus(order)] || "fa-circle";
  const progress = Number(di.deliveryProgress) || 0;
  const delayInfo = delayed ? calcDeliveryDelay(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate) : { days: 0, penalty: 0, percent: 0 };
  const late = di.committedDeliveryDate && !di.actualDeliveryDate && new Date(di.committedDeliveryDate) < new Date();
  const openSnags = (Array.isArray(di.snagList) ? di.snagList : []).filter(s => s.status !== 'closed').length;
  const customerPrefers = di.customerConfirmed && (di.confirmDate || di.confirmTime)
    ? `${esc(di.confirmDate || "Anytime")}${di.confirmTime ? " · " + esc(fmtTime(di.confirmTime)) : ""}`
    : "Not provided";

  const penaltyLine = delayed && delayInfo.penalty > 0
    ? `<div class="penalty-line">Delay Penalty: ${fmtCurrency(delayInfo.penalty)} (${delayInfo.percent}% of price)</div>`
    : `<div class="penalty-line is-muted">No delay penalty applied</div>`;

  const action = canViewDelivery()
    ? `<button class="dd-manage-btn" onclick="openDeliveryModal('${esc(order.orderId)}')"><i class="fa-solid ${window.currentRole === 'admin' ? 'fa-eye' : 'fa-pen-to-square'}"></i> ${window.currentRole === 'admin' ? 'View Delivery' : 'Manage Delivery'}</button>`
    : `<span class="dd-action-empty">No delivery actions</span>`;

  return `
  <article class="dd-card${delayed ? " is-delayed" : ""}${overdue ? " is-overdue" : ""}">
    <div class="dd-card-top" data-delivery-slot="status">
      <span class="status-badge ${statusClass(status)}"><i class="fa-solid ${statusIcon}"></i> ${esc(status)}</span>
      ${overdue ? `<span class="status-badge overdue"><i class="fa-solid fa-triangle-exclamation"></i> Overdue</span>` : ""}
      ${di.customerConfirmed ? `<span class="status-badge" style="background:#eff6ff;color:#1d4ed8;"><i class="fas fa-clipboard-check"></i> Customer confirmed</span>` : ""}
      ${delayed ? `<span class="delay-badge"><i class="fas fa-exclamation-triangle"></i> ${delayInfo.days}d late</span>` : ""}
      ${di.termsAcknowledgedAt ? `<span class="terms-signed-chip"><i class="fas fa-file-signature"></i> Signed</span>` : ""}
      ${openSnags > 0 ? `<span class="delay-badge" style="background:#fff7ed;color:#c2410c;border:1px solid #fdba74;"><i class="fas fa-flag"></i> ${openSnags} snag${openSnags > 1 ? 's' : ''}</span>` : ""}
    </div>
    <div class="dd-card-identity" data-delivery-slot="identity">
      <div class="dd-card-thumb">
        <img src="${esc(boatImageFor(order))}" alt="${esc(order.boatName || "Boat")}" loading="lazy" onerror="this.onerror=null;this.src='./images/boat2.jpg';">
      </div>
      <div class="dd-card-identity-text">
        <div class="dd-boat">${esc(order.boatName)}</div>
        <div class="dd-customer">${esc(order.customerName || "Unknown customer")}</div>
        <div class="dd-orderid">${esc(order.orderId)}</div>
      </div>
    </div>
    <div class="dd-meta" data-delivery-slot="info">
      <span><i class="fa-solid fa-calendar-day"></i> Committed: <strong class="${late ? "late" : ""}">${esc(fmtDate(di.committedDeliveryDate))}</strong></span>
      <span><i class="fa-solid fa-calendar-check"></i> Customer prefers: <strong>${customerPrefers}</strong></span>
      <span><i class="fa-solid fa-circle-check"></i> Actual: <strong>${esc(fmtDate(di.actualDeliveryDate))}</strong></span>
      <span><i class="fa-solid fa-location-dot"></i> ${esc(di.deliveryLocation || di.confirmLocation || "Location TBC")}</span>
      <span><i class="fa-solid fa-user-check"></i> Contact: ${esc(di.contactPerson || di.confirmContact || "TBA")}</span>
    </div>
    <div class="dd-badges" data-delivery-slot="sea-trial">
      ${seaTrialBadge(di.seaTrialResults)}
      <span style="font-size:11px;color:#94a3b8;">Sea Trial</span>
    </div>
    <div class="dd-slot dd-slot--progress" data-delivery-slot="progress">
      <div class="progress-text"><span>Delivery Progress</span><span style="font-weight:700;color:#071b47;">${progress}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
    </div>
    <div class="dd-slot dd-slot--penalty" data-delivery-slot="penalty">${penaltyLine}</div>
    <div class="dd-slot dd-slot--action" data-delivery-slot="action">${action}</div>
  </article>`;
}

const COLUMN_IDS = {
  "Preparing for Delivery": { body: "colBodyPreparing", count: "colPreparing", icon: "fa-box", empty: "No preparing orders" },
  "Ready for Delivery": { body: "colBodyReady", count: "colReady", icon: "fa-screwdriver-wrench", empty: "No ready orders" },
  "In Transit": { body: "colBodyTransit", count: "colTransit", icon: "fa-ship", empty: "No in-transit orders" },
  "Delivered": { body: "colBodyDelivered", count: "colDelivered", icon: "fa-circle-check", empty: "No delivered orders" },
  "Overdue": { body: "colBodyOverdue", count: "colOverdue", icon: "fa-triangle-exclamation", empty: "No overdue orders" },
};

function emptyColumnHtml(status, noResults) {
  const icon = noResults ? "fa-magnifying-glass" : (COLUMN_IDS[status]?.icon || "fa-inbox");
  const message = noResults ? "No matches" : (COLUMN_IDS[status]?.empty || "Nothing here yet");
  return `<div class="dd-empty-col"><i class="fa-solid ${icon}"></i><span>${message}</span></div>`;
}

function render() {
  const stats = { preparing: 0, ready: 0, transit: 0, delivered: 0, overdue: 0 };
  allOrders.forEach((o) => {
    const status = boardStatus(o);
    if (status === "Preparing for Delivery") stats.preparing++;
    else if (status === "Ready for Delivery") stats.ready++;
    else if (status === "In Transit") stats.transit++;
    else if (status === "Delivered") stats.delivered++;
    else if (status === "Overdue") stats.overdue++;
  });
  document.getElementById("statPreparing").textContent = stats.preparing;
  document.getElementById("statReady").textContent = stats.ready;
  document.getElementById("statTransit").textContent = stats.transit;
  document.getElementById("statDelivered").textContent = stats.delivered;
  document.getElementById("statOverdue").textContent = stats.overdue;

  const board = document.getElementById("ddBoard");
  const empty = document.getElementById("ddEmpty");
  if (allOrders.length === 0) {
    board.style.display = "none";
    empty.style.display = "block";
    return;
  }

  board.style.display = "grid";
  empty.style.display = "none";

  const visible = visibleOrders();
  const noResults = visible.length === 0;
  const grouped = Object.fromEntries(Object.keys(COLUMN_IDS).map((status) => [status, []]));
  visible.forEach((o) => {
    const key = boardStatus(o);
    if (grouped[key]) grouped[key].push(o);
  });

  Object.entries(COLUMN_IDS).forEach(([status, ids]) => {
    const inColumn = grouped[status] || [];
    document.getElementById(ids.count).textContent = inColumn.length;
    document.getElementById(ids.body).innerHTML = inColumn.length === 0
      ? emptyColumnHtml(status, noResults)
      : inColumn.map(cardHtml).join("");
  });
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll("#ddFilters .dd-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  document.querySelectorAll("#ddStats .dd-stat[data-filter]").forEach((card) => {
    card.classList.toggle("active", card.dataset.filter === filter);
  });
  render();
}

function wireControls() {
  const search = document.getElementById("ddSearch");
  search?.addEventListener("input", () => {
    searchQuery = search.value.trim().toLowerCase();
    render();
  });

  document.querySelectorAll("#ddFilters .dd-chip").forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
  });
  document.querySelectorAll("#ddStats .dd-stat[data-filter]").forEach((card) => {
    card.addEventListener("click", () => setFilter(card.dataset.filter));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setFilter(card.dataset.filter);
      }
    });
  });

  const toggle = document.getElementById("ddFilterToggle");
  const filters = document.getElementById("ddFilters");
  toggle?.addEventListener("click", () => {
    const hidden = filters?.classList.toggle("is-hidden");
    toggle.setAttribute("aria-expanded", String(!hidden));
  });
}

(async function init() {
  const auth = await window.requireRole(["admin", "manager"]);
  if (!auth) return;
  window.currentRole = auth.profile.role;

  // Staff terms reference (same wording the customer signs)
  const termsList = document.getElementById("ddTermsList");
  if (termsList) {
    termsList.innerHTML = DELIVERY_TERMS.map((t) => `<li>${t}</li>`).join("");
  }

  const { data, error } = await supabase
    .from("boat_orders")
    .select("*")
    .order("createdAt", { ascending: false });

  if (error) {
    showToast("Could not load orders: " + error.message, "error");
    allOrders = [];
  } else {
    allOrders = (data || []).filter(isInDelivery);
  }

  wireControls();
  render();

  // Keep the board in sync when a customer confirms delivery in another tab.
  const channel = supabase.channel("delivery-board-" + (window.currentRole || "staff"));
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "boat_orders" },
    async () => {
      try {
        const { data: refreshed, error: refreshErr } = await supabase
          .from("boat_orders")
          .select("*")
          .order("createdAt", { ascending: false });
        if (refreshErr) throw refreshErr;
        allOrders = (refreshed || []).filter(isInDelivery);
        render();
      } catch (e) {
        console.error("Delivery realtime refresh failed:", e);
      }
    }
  );
  channel.subscribe();

  window.addEventListener("delivery:saved", async () => {
    const refreshed = await supabase
      .from("boat_orders")
      .select("*")
      .order("createdAt", { ascending: false });
    if (!refreshed.error) {
      allOrders = (refreshed.data || []).filter(isInDelivery);
      render();
    }
  });
})();
