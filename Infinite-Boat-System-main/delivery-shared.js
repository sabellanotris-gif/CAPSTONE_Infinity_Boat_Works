// ============ SHARED DELIVERY LOGIC ============
// Shared by dashprogress.js (Boat Progress page), delivery.js
// (Delivery pipeline page) and home.js (customer Delivery tab).
// Keep everything here in sync-free, self-contained form: pure helpers +
// the manage modal. Boards/pages wire the UI around it.

import { supabase, API_BASE } from "./supabase.js";
import { DELIVERY_TERMS, PENALTY_TIERS, DELIVERY_PENALTY_RULE } from "./delivery-terms.js";

export { DELIVERY_TERMS, PENALTY_TIERS, DELIVERY_PENALTY_RULE };

const deliveryRegistry = new Map();

export function registerDeliveryOrder(order) {
  if (order && order.orderId) deliveryRegistry.set(order.orderId, order);
}
function getDeliveryOrder(orderId) {
  return deliveryRegistry.get(orderId) || null;
}

// ============ SNAG LIST (acceptance defects) ============
// Stored inside deliveryInfo.snagList. Cycle: open → progress → closed.

function renderSnagListRows() {
  const container = document.getElementById('snagListRows');
  if (!container) return;
  const list = (currentDeliveryOrder && Array.isArray(currentDeliveryOrder.deliveryInfo?.snagList))
    ? currentDeliveryOrder.deliveryInfo.snagList
    : [];
  const openCount = list.filter(s => s.status !== 'closed').length;
  const badge = document.getElementById('snagCountBadge');
  if (badge) badge.textContent = openCount > 0 ? `· ${openCount} open` : '';
  if (list.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:10px 0;">No defects reported yet.</div>';
    return;
  }
  container.innerHTML = list.map(s => {
    const statusMeta = s.status === 'closed'
      ? { label: 'CLOSED', cls: 'background:#dcfce7;color:#15803d;' }
      : s.status === 'progress'
        ? { label: 'IN PROGRESS', cls: 'background:#fef9c3;color:#a16207;' }
        : { label: 'OPEN', cls: 'background:#fee2e2;color:#b91c1c;' };
    const nextStatus = s.status === 'open' ? 'progress' : s.status === 'progress' ? 'closed' : 'open';
    const nextLabel = s.status === 'open' ? 'Start' : s.status === 'progress' ? 'Close' : 'Reopen';
    return `
    <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;">
        <button onclick="staffCycleSnag('${s.id}', '${nextStatus}')" style="border:none;border-radius:8px;padding:5px 8px;font-size:10px;font-weight:800;letter-spacing:.4px;cursor:pointer;white-space:nowrap;${statusMeta.cls}">${statusMeta.label} ▸ ${nextLabel}</button>
        <div style="flex:1;min-width:0;">
            <div style="font-size:13px;color:#0f172a;">${escapeHtml(s.title)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${escapeHtml(s.addedName || '—')} · ${new Date(s.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <i class="fas fa-trash-can" onclick="staffDeleteSnag('${s.id}')" style="color:#ef4444;font-size:12px;cursor:pointer;padding:4px;" title="Remove snag"></i>
    </div>`;
  }).join("");
}

function updateSnagInOrder(updated) {
  if (!currentDeliveryOrder || !updated) return;
  currentDeliveryOrder.deliveryInfo = updated.deliveryInfo || currentDeliveryOrder.deliveryInfo;
  registerDeliveryOrder(currentDeliveryOrder);
  // keep the board/dashprogress card in sync too if it is listening
  window.dispatchEvent(new CustomEvent('delivery:saved', {
    detail: { orderId: currentDeliveryOrder.orderId, order: currentDeliveryOrder, deliveryInfo: currentDeliveryOrder.deliveryInfo }
  }));
  renderSnagListRows();
}

async function staffPost(method, url, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(API_BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

window.staffAddSnag = async function () {
  const input = document.getElementById('snagInput');
  const title = (input?.value || '').trim();
  if (!title) return;
  const order = currentDeliveryOrder;
  if (!order) return;
  try {
    const updated = await staffPost('POST', '/orders/' + encodeURIComponent(order.orderId) + '/snag', { title });
    input.value = '';
    updateSnagInOrder(updated);
    showToast('Snag added', 'success');
  } catch (e) { console.error(e); showToast('Failed to add snag: ' + e.message, 'error'); }
};

window.staffCycleSnag = async function (id, nextStatus) {
  const order = currentDeliveryOrder;
  if (!order) return;
  try {
    const updated = await staffPost('PUT', '/orders/' + encodeURIComponent(order.orderId) + '/snag/' + encodeURIComponent(id), { status: nextStatus });
    updateSnagInOrder(updated);
  } catch (e) { console.error(e); showToast('Failed to update snag: ' + e.message, 'error'); }
};

window.staffDeleteSnag = async function (id) {
  const order = currentDeliveryOrder;
  if (!order) return;
  const snag = (order.deliveryInfo?.snagList || []).find(s => s.id === id);
  if (!snag) return;
  if (!confirm('Remove snag: "' + String(snag.title).slice(0, 60) + '"?')) return;
  try {
    const updated = await staffPost('DELETE', '/orders/' + encodeURIComponent(order.orderId) + '/snag/' + encodeURIComponent(id));
    updateSnagInOrder(updated);
  } catch (e) { console.error(e); showToast('Failed to remove snag: ' + e.message, 'error'); }
};

// ============ PRE-DELIVERY CHECKLIST (PDI) ============
const PDI_ITEMS = [
  { key: 'engine', label: 'Engine run under load — temps & oil pressure OK' },
  { key: 'safety', label: 'Safety gear complete (jackets, extinguishers, flares/EPIRB)' },
  { key: 'electronics', label: 'Navigation & electronics powered and tested' },
  { key: 'bilge', label: 'Bilge pumps and alarms working' },
  { key: 'docs', label: 'Documents package ready (manuals, warranty, registration)' },
  { key: 'insurance', label: 'Insurance confirmed from handover date' },
  { key: 'keys', label: 'Keys and spare keys ready to hand over' },
  { key: 'hull', label: 'Hull, rails and fittings inspected — no damage' },
];

function renderChecklistInto(di) {
  const container = document.getElementById('pdiList');
  if (!container) return;
  const cl = di && typeof di.checklist === 'object' && !Array.isArray(di.checklist) ? di.checklist : {};
  container.innerHTML = PDI_ITEMS.map(item => `
    <label style="display:flex;align-items:flex-start;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px 10px;font-size:12px;color:#0f172a;cursor:pointer;line-height:1.45;">
        <input type="checkbox" data-pdi="${item.key}" ${cl[item.key] ? 'checked' : ''} style="margin-top:2px;">
        <span>${escapeHtml(item.label)}</span>
    </label>`).join("");
  container.querySelectorAll('input[data-pdi]').forEach(cb => cb.addEventListener('change', updatePdiCounter));
  updatePdiCounter();
}

function updatePdiCounter() {
  const boxes = document.querySelectorAll('#pdiList input[data-pdi]');
  const total = boxes.length;
  const done = [...boxes].filter(b => b.checked).length;
  const el = document.getElementById('pdiCounter');
  if (el) {
    el.textContent = '· ' + done + '/' + total + ' done';
    el.style.color = done === total ? '#15803d' : '#b45309';
  }
}

// Both admins and managers can manage deliveries. Writes go through the
// Express API (service-role), because the DB field-guard trigger restricts
// deliveryInfo to admin/service-role writers — direct client writes by
// managers would be silently discarded.
export function canManageDelivery() {
  return window.currentRole === "admin" || window.currentRole === "manager";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtTime(t) {
  if (!t) return '';
  const parts = String(t).split(':');
  const h24 = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  if (isNaN(h24)) return String(t);
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = (h24 % 12) || 12;
  return h12 + ':' + m + ' ' + suffix;
}

export function fmtDate(dateStr) {
    if (!dateStr || dateStr === 'To be determined') return 'Not set';
    try { return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch { return dateStr; }
}

export function fmtCurrency(val) {
    return '₱' + (parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function getDeliveryStatus(order) {
    const di = order.deliveryInfo || {};
    if (di.deliveryStatus) return di.deliveryStatus;
    return 'Preparing for Delivery';
}

export function isDelayed(order) {
    const di = order.deliveryInfo || {};
    if (di.delayDays && di.delayDays > 0) return true;
    if (di.actualDeliveryDate && di.committedDeliveryDate) {
        return new Date(di.actualDeliveryDate) > new Date(di.committedDeliveryDate);
    }
    return false;
}

export function calcDeliveryDelay(boatPrice, committedDate, actualDate) {
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

function statusClass(status) {
    return status === 'Preparing for Delivery' ? 'preparing'
        : status === 'Ready for Delivery' ? 'ready'
        : status === 'In Transit' ? 'transit'
        : 'delivered';
}

export function renderDeliveryCard(order) {
    const di = order.deliveryInfo || {};
    const status = getDeliveryStatus(order);
    const delayed = isDelayed(order);
    const delayInfo = calcDeliveryDelay(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate);
    const progress = di.deliveryProgress || 0;
    const badgeClass = statusClass(status);
    const cardStatusClass = delayed && status !== 'Delivered' ? 'status-delayed' : 'status-' + badgeClass;
    registerDeliveryOrder(order);
    return `
    <div class="delivery-card ${cardStatusClass}" style="margin:0;box-shadow:none;padding:0;border-left:none;">
        <div class="card-header">
            <div class="card-badges">
                <span class="status-badge ${badgeClass}">${status}</span>
                ${delayed ? `<span class="delay-badge"><i class="fas fa-exclamation-triangle"></i> ${delayInfo.days}d late</span>` : ''}
                ${di.termsAcknowledgedAt ? `<span class="delay-badge" style="background:#f0fdf4;color:#15803d;"><i class="fas fa-file-signature"></i> Terms signed</span>` : ''}
            </div>
            ${canManageDelivery() ? `<button class="manage-btn" onclick="openDeliveryModal('${order.orderId}')" style="padding:8px 16px;font-size:12px;border:none;border-radius:12px;background:#356cff;color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="fas fa-edit"></i> Manage</button>` : ''}
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

let currentDeliveryOrder = null;

export function openDeliveryModal(orderOrId) {
    if (!canManageDelivery()) return;
    let order = null;
    if (orderOrId && typeof orderOrId === 'string') order = getDeliveryOrder(orderOrId);
    else if (orderOrId && typeof orderOrId === 'object') order = orderOrId;
    if (!order) return;
    registerDeliveryOrder(order);
    currentDeliveryOrder = order;
    const di = order.deliveryInfo || {};
    const status = getDeliveryStatus(order);
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
    ${di.customerConfirmed ? `
    <div class="penalty-preview" style="background:#eff6ff;border-color:#bfdbfe;margin-bottom:16px;">
        <h5 style="color:#1d4ed8;"><i class="fas fa-clipboard-check"></i> Customer Delivery Confirmation</h5>
        <div style="font-size:12px;color:#1e3a8a;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><strong>Requested by:</strong><br>${escapeHtml(di.confirmName || 'Customer')}${di.customerConfirmedAt ? `<br><span style="font-size:10px;color:#3b82f6;">${new Date(di.customerConfirmedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>` : ''}</div>
            <div><strong>Preferred:</strong><br>${escapeHtml(di.confirmDate || 'Anytime')}${di.confirmTime ? ' · ' + escapeHtml(fmtTime(di.confirmTime)) : ''}</div>
            <div><strong>Location:</strong><br>${escapeHtml(di.confirmLocation || '—')}</div>
            <div><strong>Contact:</strong><br>${escapeHtml(di.confirmContact || '—')}</div>
        </div>
    </div>` : `
    <div class="penalty-preview penalty-none" style="margin-bottom:16px;">
        <h5><i class="fas fa-circle-info"></i> Customer Confirmation Pending</h5>
        <div style="font-size:13px;">The customer has not submitted their delivery details yet. Once they confirm in the customer portal, this order enters the delivery pipeline and their answers appear here.</div>
    </div>`}
    <div class="modal-section">
        <h4><i class="fas fa-flag"></i> Snag List <span id="snagCountBadge" style="font-size:11px;color:#dc2626;font-weight:800;margin-left:6px;"></span></h4>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input type="text" id="snagInput" placeholder="Describe a defect found at sea trial..." maxlength="200" style="flex:1;padding:9px 12px;border:2px solid #e2e8f0;border-radius:10px;font-family:'Poppins',sans-serif;font-size:13px;outline:none;">
            <button onclick="staffAddSnag()" style="padding:9px 14px;border:none;border-radius:10px;background:#dc2626;color:#fff;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;"><i class="fas fa-plus"></i> Add</button>
        </div>
        <div id="snagListRows" style="display:flex;flex-direction:column;gap:6px;"></div>
    </div>
    <div class="modal-section">
        <h4><i class="fas fa-clipboard-check"></i> Pre-delivery Checklist <span id="pdiCounter" style="font-size:11px;color:#15803d;font-weight:800;margin-left:6px;"></span></h4>
        <div id="pdiList" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"></div>
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
                <input type="text" id="modalLocation" value="${escapeHtml(di.deliveryLocation || di.confirmLocation || '')}" placeholder="Address or port">
            </div>
            <div class="form-group">
                <label>Contact Person</label>
                <input type="text" id="modalContact" value="${escapeHtml(di.contactPerson || di.confirmContact || '')}" placeholder="Customer name or contact">
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
    ${di.termsAcknowledgedAt ? `
    <div class="penalty-preview" style="background:#f0fdf4;border-color:#bbf7d0;">
        <h5 style="color:#15803d;"><i class="fas fa-file-signature"></i> Delivery Terms Accepted</h5>
        <div style="font-size:13px;color:#166534;">Accepted by <strong>${escapeHtml(di.acknowledgmentName || 'Customer')}</strong> on ${new Date(di.termsAcknowledgedAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}.</div>
        ${di.acknowledgmentSignature ? (/^(data:|https?:)/.test(String(di.acknowledgmentSignature).trim())
            ? `<img src="${escapeHtml(di.acknowledgmentSignature)}" alt="Customer signature" style="margin-top:10px;max-width:220px;border:1px solid #bbf7d0;border-radius:8px;background:#fff;">`
            : `<p style="font-family:'Brush Script MT',cursive;font-size:20px;color:#0f172a;margin-top:10px;">${escapeHtml(di.acknowledgmentSignature)}</p>`) : ''}
    </div>` : `
    <div class="penalty-preview penalty-none" style="margin-bottom:4px;">
        <h5><i class="fas fa-circle-info"></i> Customer Signature Pending</h5>
        <div style="font-size:13px;">The customer will be asked to sign the Delivery Terms in their project page once the boat is In Transit or Delivered.</div>
    </div>`}
    <button class="save-btn" id="saveDeliveryBtn" onclick="saveDelivery()"><i class="fas fa-save"></i> Save Delivery Details</button>`;
    document.getElementById('deliveryModal').classList.add('show');
    renderSnagListRows();
    renderChecklistInto(di);
    previewPenalty();
}

export function updateActualDateMin() {
    const committed = document.getElementById('modalCommittedDate');
    const actual = document.getElementById('modalActualDate');
    if (committed && actual) {
        actual.min = committed.value;
        if (actual.value && actual.value < committed.value) actual.value = committed.value;
    }
}

export function previewPenalty() {
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
    const order = currentDeliveryOrder;
    const price = parseInt(String(order?.boatPrice || '0').replace(/[^0-9]/g, '')) || 0;
    let pct = 0;
    if (days >= 1 && days <= 7) pct = 1;
    else if (days >= 8 && days <= 14) pct = 2;
    else if (days >= 15 && days <= 30) pct = 5;
    else if (days > 30) pct = 8;
    const penalty = Math.round(price * (pct / 100));
    previewEl.innerHTML = '<div class="penalty-preview"><h5><i class="fas fa-exclamation-triangle"></i> Delay Penalty Preview</h5><div class="penalty-amount">' + fmtCurrency(penalty) + '</div><div class="penalty-info">' + days + ' day(s) late | ' + pct + '% of boat price (' + fmtCurrency(price) + ')</div></div>';
}

export async function saveDelivery() {
    if (!canManageDelivery()) return;
    const order = currentDeliveryOrder;
    if (!order) return;
    // Soft guards: warn when handing over with open defects or an unchecked
    // PDI list, but still allow staff to proceed.
    if (document.getElementById('modalStatus')?.value === 'Delivered') {
        const list = Array.isArray(currentDeliveryOrder?.deliveryInfo?.snagList) ? currentDeliveryOrder.deliveryInfo.snagList : [];
        const open = list.filter(s => s.status !== 'closed').length;
        if (open > 0 && !confirm('There are ' + open + ' open snag(s). Mark as Delivered anyway?')) return;
        const pdiBoxes = document.querySelectorAll('#pdiList input[data-pdi]');
        const incomplete = [...pdiBoxes].filter(b => !b.checked).length;
        if (incomplete > 0 && !confirm('Checklist is not complete (' + incomplete + ' item(s) unchecked). Mark as Delivered anyway?')) return;
    }
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
    // Collect the pre-delivery checklist as a flat boolean map.
    const checklist = {};
    document.querySelectorAll('#pdiList input[data-pdi]').forEach(cb => { checklist[cb.dataset.pdi] = cb.checked; });
    data.checklist = checklist;
    if (data.deliveryStatus === 'Delivered') {
        data.deliveryConfirmed = true;
        data.deliveryProgress = 100;
    }
    // Go through the Express API (service-role): the DB field-guard trigger
    // only lets admin/service-role writers touch deliveryInfo, so a direct
    // browser write by a manager would be silently reverted. The server also
    // recomputes the delay penalty and sends the delay-notice email.
    let updated = null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(API_BASE + '/orders/' + encodeURIComponent(order.orderId) + '/delivery', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: JSON.stringify(data)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || ('Save failed (HTTP ' + res.status + ')'));
        updated = Array.isArray(body) ? body[0] : body;
    } catch (err) {
        showToast('Error saving delivery: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Delivery Details';
        return;
    }
    const newInfo = (updated && updated.deliveryInfo) || { ...(order.deliveryInfo || {}), ...data };
    order.deliveryInfo = newInfo;
    registerDeliveryOrder(order);
    showToast('Delivery details saved successfully!', 'success');
    closeDeliveryModal();
    window.dispatchEvent(new CustomEvent('delivery:saved', {
        detail: { orderId: order.orderId, order, deliveryInfo: newInfo }
    }));
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Delivery Details';
}

export function closeDeliveryModal() {
    document.getElementById('deliveryModal').classList.remove('show');
    currentDeliveryOrder = null;
}

// Keep the inline onclick handlers in the modal working with one shared copy.
window.openDeliveryModal = openDeliveryModal;
window.updateActualDateMin = updateActualDateMin;
window.previewPenalty = previewPenalty;
window.saveDelivery = saveDelivery;
window.closeDeliveryModal = closeDeliveryModal;
