// ============ SHARED DELIVERY LOGIC ============
// Shared by dashprogress.js (Boat Progress page) and dashdelivery.js
// (Delivery pipeline page). Keep everything here in sync-free, self-contained
// form: pure helpers + the manage modal. Boards/pages wire the UI around it.

import { supabase } from "./supabase.js";

const deliveryRegistry = new Map();

function registerDeliveryOrder(order) {
  if (order && order.orderId) deliveryRegistry.set(order.orderId, order);
}
function getDeliveryOrder(orderId) {
  return deliveryRegistry.get(orderId) || null;
}

// Both admins and managers can manage deliveries.
export function canManageDelivery() {
  return window.currentRole === "admin" || window.currentRole === "manager";
}

export const DELIVERY_TERMS = [
  "The committed delivery date is honored when the order is fully paid and the sea trial is Passed (or Conditional, accepted in writing).",
  "If the delivery passes the committed date, the following is deducted from the remaining balance: 1% of the boat price for 1–7 days late, 2% for 8–14 days, 5% for 15–30 days, and 8% for more than 30 days late.",
  "Sea trial results must be Passed (or Conditional, accepted in writing) before the boat is released for delivery.",
  "An authorized customer representative must receive the vessel, complete the check-out, and sign the delivery acknowledgement at handover.",
  "The warranty period starts upon confirmed delivery, per your order's warranty terms.",
  "Any complaint about the delivery condition must be raised at, or within 7 days of, acceptance.",
  "Delivery is made per the method for your boat model (flatbed trailer or sea tow), as stated in the order.",
];

export const PENALTY_TIERS = [
  { label: "1–7 days late", percent: 1 },
  { label: "8–14 days late", percent: 2 },
  { label: "15–30 days late", percent: 5 },
  { label: "Over 30 days late", percent: 8 },
];

export const DELIVERY_PENALTY_RULE = "1% (1–7 days late) · 2% (8–14 days) · 5% (15–30 days) · 8% (over 30 days) of the boat price, deducted from the remaining balance.";

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
    ${di.termsAcknowledgedAt ? `
    <div class="penalty-preview" style="background:#f0fdf4;border-color:#bbf7d0;">
        <h5 style="color:#15803d;"><i class="fas fa-file-signature"></i> Delivery Terms Accepted</h5>
        <div style="font-size:13px;color:#166534;">Accepted by <strong>${di.acknowledgmentName || 'Customer'}</strong> on ${new Date(di.termsAcknowledgedAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}.</div>
        ${di.acknowledgmentSignature ? `<img src="${di.acknowledgmentSignature}" alt="Customer signature" style="margin-top:10px;max-width:220px;border:1px solid #bbf7d0;border-radius:8px;background:#fff;">` : ''}
    </div>` : `
    <div class="penalty-preview penalty-none" style="margin-bottom:4px;">
        <h5><i class="fas fa-circle-info"></i> Customer Signature Pending</h5>
        <div style="font-size:13px;">The customer will be asked to sign the Delivery Terms in their project page once the boat is In Transit or Delivered.</div>
    </div>`}
    <button class="save-btn" id="saveDeliveryBtn" onclick="saveDelivery()"><i class="fas fa-save"></i> Save Delivery Details</button>`;
    document.getElementById('deliveryModal').classList.add('show');
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
        registerDeliveryOrder(order);
        showToast('Delivery details saved successfully!', 'success');
        closeDeliveryModal();
        window.dispatchEvent(new CustomEvent('delivery:saved', {
            detail: { orderId: order.orderId, order, deliveryInfo: newInfo }
        }));
    }
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
