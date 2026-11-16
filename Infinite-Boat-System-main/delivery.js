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
} from "./delivery-shared.js?v=5";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

const STATUS_ORDER = ["Preparing for Delivery", "Ready for Delivery", "In Transit", "Delivered"];

let allOrders = [];
let currentFilter = "all";
let searchQuery = "";

function statusClass(status) {
  return status === "Preparing for Delivery" ? "preparing"
    : status === "Ready for Delivery" ? "ready"
    : status === "In Transit" ? "transit"
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

function visibleOrders() {
  return allOrders.filter((o) => {
    const status = getDeliveryStatus(o);
    const delayed = isDelayed(o) && status !== "Delivered";
    if (currentFilter === "delayed" && !delayed) return false;
    if (currentFilter === "delivered" && status !== "Delivered") return false;
    if (searchQuery) {
      const hay = `${o.boatName || ""} ${o.customerName || ""} ${o.orderId || ""}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
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
  const progress = Number(di.deliveryProgress) || 0;
  const delayInfo = delayed ? calcDeliveryDelay(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate) : { days: 0, penalty: 0, percent: 0 };
  const late = di.committedDeliveryDate && !di.actualDeliveryDate && new Date(di.committedDeliveryDate) < new Date();

  return `
  <article class="dd-card${delayed ? " is-delayed" : ""}">
    <div class="dd-card-top">
      <span class="status-badge ${statusClass(status)}">${esc(status)}</span>
      ${delayed ? `<span class="delay-badge"><i class="fas fa-exclamation-triangle"></i> ${delayInfo.days}d late</span>` : ""}
      ${di.termsAcknowledgedAt ? `<span class="terms-signed-chip"><i class="fas fa-file-signature"></i> Signed</span>` : ""}
      ${((Array.isArray(di.snagList) ? di.snagList : []).filter(s => s.status !== 'closed').length) > 0 ? `<span class="delay-badge" style="background:#fff7ed;color:#c2410c;border:1px solid #fdba74;"><i class="fas fa-flag"></i> ${(Array.isArray(di.snagList) ? di.snagList : []).filter(s => s.status !== 'closed').length} snag${((Array.isArray(di.snagList) ? di.snagList : []).filter(s => s.status !== 'closed').length) > 1 ? 's' : ''}</span>` : ""}
    </div>
    <div>
      <div class="dd-boat">${esc(order.boatName)}</div>
      <div class="dd-customer">${esc(order.customerName || "Unknown customer")}</div>
      <div class="dd-orderid">${esc(order.orderId)}</div>
    </div>
    <div class="dd-meta">
      <span><i class="fa-solid fa-calendar-day"></i> Committed: <strong class="${late ? "late" : ""}">${esc(fmtDate(di.committedDeliveryDate))}</strong></span>
      ${di.customerConfirmed && (di.confirmDate || di.confirmTime) ? `<span><i class="fa-solid fa-calendar-check"></i> Customer prefers: <strong>${esc(di.confirmDate || "Anytime")}${di.confirmTime ? " · " + esc(fmtTime(di.confirmTime)) : ""}</strong></span>` : ""}
      <span><i class="fa-solid fa-circle-check"></i> Actual: <strong>${esc(fmtDate(di.actualDeliveryDate))}</strong></span>
      <span><i class="fa-solid fa-location-dot"></i> ${esc(di.deliveryLocation || "Location TBC")}</span>
    </div>
    <div class="dd-badges">
      ${seaTrialBadge(di.seaTrialResults)}
      <span style="font-size:11px;color:#94a3b8;">Sea Trial</span>
    </div>
    <div class="progress-text"><span>Delivery Progress</span><span style="font-weight:700;color:#071b47;">${progress}%</span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
    ${delayed && delayInfo.penalty > 0 ? `<div class="penalty-line">Delay Penalty: ${fmtCurrency(delayInfo.penalty)} (${delayInfo.percent}% of price)</div>` : ""}
    ${canManageDelivery() ? `<button class="dd-manage-btn" onclick="openDeliveryModal('${esc(order.orderId)}')"><i class="fa-solid fa-pen-to-square"></i> Manage Delivery</button>` : ""}
  </article>`;
}

const COLUMN_IDS = {
  "Preparing for Delivery": { body: "colBodyPreparing", count: "colPreparing" },
  "Ready for Delivery": { body: "colBodyReady", count: "colReady" },
  "In Transit": { body: "colBodyTransit", count: "colTransit" },
  "Delivered": { body: "colBodyDelivered", count: "colDelivered" },
};

function render() {
  const stats = { preparing: 0, ready: 0, transit: 0, delivered: 0, overdue: 0 };
  allOrders.forEach((o) => {
    const status = getDeliveryStatus(o);
    if (status === "Preparing for Delivery") stats.preparing++;
    else if (status === "Ready for Delivery") stats.ready++;
    else if (status === "In Transit") stats.transit++;
    else if (status === "Delivered") stats.delivered++;
    if (isDelayed(o) && status !== "Delivered") stats.overdue++;
  });
  document.getElementById("statPreparing").textContent = stats.preparing;
  document.getElementById("statReady").textContent = stats.ready;
  document.getElementById("statTransit").textContent = stats.transit;
  document.getElementById("statDelivered").textContent = stats.delivered;
  document.getElementById("statOverdue").textContent = stats.overdue;

  const visible = visibleOrders();
  Object.keys(COLUMN_IDS).forEach((status) => {
    const ids = COLUMN_IDS[status];
    const body = document.getElementById(ids.body);
    const inColumn = visible.filter((o) => getDeliveryStatus(o) === status);
    document.getElementById(ids.count).textContent = inColumn.length;
    body.innerHTML = inColumn.length === 0
      ? '<div class="dd-empty-col">Nothing here yet</div>'
      : inColumn.map(cardHtml).join("");
  });

  const board = document.getElementById("ddBoard");
  const empty = document.getElementById("ddEmpty");
  const noResults = visible.length === 0 && allOrders.length > 0;
  if (allOrders.length === 0) {
    board.style.display = "none";
    empty.style.display = "block";
  } else if (noResults) {
    board.style.display = "grid";
    empty.style.display = "none";
    Object.keys(COLUMN_IDS).forEach((status) => {
      document.getElementById(COLUMN_IDS[status].body).innerHTML =
        '<div class="dd-empty-col">No matches</div>';
    });
  } else {
    board.style.display = "grid";
    empty.style.display = "none";
  }
}

function wireControls() {
  const search = document.getElementById("ddSearch");
  search?.addEventListener("input", () => {
    searchQuery = search.value.trim().toLowerCase();
    render();
  });
  document.querySelectorAll("#ddFilters .dd-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ddFilters .dd-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      render();
    });
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
