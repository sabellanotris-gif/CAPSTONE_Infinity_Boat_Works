import { supabase, handleDbError, sendEmailNotification, API_BASE } from './supabase.js';

window.handleLogout = async function () {
    await supabase.auth.signOut();
    localStorage.clear();
    window.location.href = "index.html";
};

let allOrders = [];
let activeFilter = 'all';

function dateToISO(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
}

window._updateActualDateMin = function () {
    const committed = document.getElementById('modalCommittedDate');
    const actual = document.getElementById('modalActualDate');
    if (committed && actual) {
        actual.min = committed.value;
        if (actual.value && actual.value < committed.value) {
            actual.value = committed.value;
        }
    }
};

async function checkAuth() {
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return false;
    }
    // Auto-refresh if token is near expiry
    try {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        const expiresIn = payload.exp * 1000 - Date.now();
        if (expiresIn < 300000) {
            await supabase.auth.refreshSession();
        }
    } catch (e) { /* ignore refresh errors */ }
    return true;
}

function showToast(msg, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function parseAmount(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
}

function formatCurrency(val) {
    return '₱' + parseAmount(val).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
    if (!dateStr || dateStr === 'To be determined') return 'Not set';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

function parseBuildDurationToMonths(durStr) {
    if (!durStr) return 6;
    const upper = durStr.toUpperCase();
    const num = parseFloat(upper) || 0;
    if (upper.includes("YEAR")) return num * 12;
    if (upper.includes("MONTH")) return num;
    if (upper.includes("WEEK")) return Math.round(num / 4.33);
    return 6;
}

function getEstimatedCompletionDate(order) {
    const info = order.deliveryInfo || {};
    if (info.expectedDate && info.expectedDate !== "To be determined") return info.expectedDate;
    const startDate = order.createdAt ? new Date(order.createdAt) : new Date();
    const durStr = order.buildTime || "6 months";
    const months = parseBuildDurationToMonths(durStr);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);
    return endDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function getProjectDuration(order) {
    return order.buildTime || "6 months";
}

function getDeliveryStatus(order) {
    const di = order.deliveryInfo || {};
    if (di.deliveryStatus) return di.deliveryStatus;
    if (order.progress >= 100) return 'Preparing for Delivery';
    return 'Preparing for Delivery';
}

function isDelayed(order) {
    const di = order.deliveryInfo || {};
    if (di.delayDays && di.delayDays > 0) return true;
    if (di.actualDeliveryDate && di.committedDeliveryDate) {
        const actual = new Date(di.actualDeliveryDate);
        const committed = new Date(di.committedDeliveryDate);
        return actual > committed;
    }
    return false;
}

function calculateDelayPenalty(boatPrice, committedDate, actualDate) {
    if (!committedDate || !actualDate) return { days: 0, penalty: 0, percent: 0 };
    const committed = new Date(committedDate);
    const actual = new Date(actualDate);
    if (actual <= committed) return { days: 0, penalty: 0, percent: 0 };
    const diffMs = actual - committed;
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const cleanPrice = parseInt(String(boatPrice || '0').replace(/[^0-9]/g, '')) || 0;
    let percent = 0;
    if (days >= 1 && days <= 7) percent = 1;
    else if (days >= 8 && days <= 14) percent = 2;
    else if (days >= 15 && days <= 30) percent = 5;
    else if (days > 30) percent = 8;
    const penalty = Math.round(cleanPrice * (percent / 100));
    return { days, penalty, percent };
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'Preparing for Delivery': return 'preparing';
        case 'Ready for Delivery': return 'ready';
        case 'In Transit': return 'transit';
        case 'Delivered': return 'delivered';
        default: return 'preparing';
    }
}

function getStatusCardClass(status, delayed) {
    if (delayed && status !== 'Delivered') return 'status-delayed';
    switch (status) {
        case 'Preparing for Delivery': return 'status-preparing';
        case 'Ready for Delivery': return 'status-ready';
        case 'In Transit': return 'status-transit';
        case 'Delivered': return 'status-delivered';
        default: return 'status-preparing';
    }
}

window.setFilter = function(filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('#deliveryFilters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderDeliveries();
};

function updateStats() {
    const preparing = allOrders.filter(o => getDeliveryStatus(o) === 'Preparing for Delivery' && !isDelayed(o)).length;
    const ready = allOrders.filter(o => getDeliveryStatus(o) === 'Ready for Delivery' && !isDelayed(o)).length;
    const transit = allOrders.filter(o => getDeliveryStatus(o) === 'In Transit' && !isDelayed(o)).length;
    const delivered = allOrders.filter(o => getDeliveryStatus(o) === 'Delivered').length;
    const delayed = allOrders.filter(o => isDelayed(o) && getDeliveryStatus(o) !== 'Delivered').length;

    document.getElementById('statPreparing').textContent = preparing;
    document.getElementById('statReady').textContent = ready;
    document.getElementById('statTransit').textContent = transit;
    document.getElementById('statDelivered').textContent = delivered;
    document.getElementById('statDelayed').textContent = delayed;
}

function renderDeliveries() {
    const container = document.getElementById('deliveryContainer');
    const emptyState = document.getElementById('emptyState');

    let filtered = [...allOrders];

    if (activeFilter === 'Delayed') {
        filtered = allOrders.filter(o => isDelayed(o) && getDeliveryStatus(o) !== 'Delivered');
    } else if (activeFilter !== 'all') {
        filtered = allOrders.filter(o => getDeliveryStatus(o) === activeFilter && !isDelayed(o));
    }

    if (filtered.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    container.innerHTML = filtered.map((order, i) => {
        const realIndex = allOrders.indexOf(order);
        return renderDeliveryCard(order, realIndex);
    }).join('');
}

function renderDeliveryCard(order, idx) {
    const di = order.deliveryInfo || {};
    const status = getDeliveryStatus(order);
    const delayed = isDelayed(order);
    const badgeClass = getStatusBadgeClass(status);
    const cardClass = getStatusCardClass(status, delayed);
    const expectedDate = di.expectedDate && di.expectedDate !== 'To be determined' ? di.expectedDate : getEstimatedCompletionDate(order);
    const committedDate = di.committedDeliveryDate || 'Not set';
    const actualDate = di.actualDeliveryDate || 'Not set';
    const location = di.deliveryLocation || 'To be confirmed';
    const contact = di.contactPerson || 'To be assigned';
    const seaTrial = di.seaTrialResults || 'Pending';
    const progress = di.deliveryProgress || 0;
    const delayInfo = calculateDelayPenalty(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate);
    const buildDuration = getProjectDuration(order);

    return `
    <div class="delivery-card ${cardClass}">
        <div class="card-header">
            <div class="card-header-left">
                ${order.boatImage ? `<img class="boat-thumb" src="${order.boatImage}" alt="${order.boatName || 'Boat'}" onerror="this.style.display='none'">` : ''}
                <div class="card-title">
                    <h3>${order.boatName || 'Unknown Boat'}</h3>
                    <p>${order.orderId || ''} — ${order.customerName || 'N/A'}</p>
                </div>
            </div>
            <div class="card-badges">
                <span class="status-badge ${badgeClass}">${status}</span>
                ${delayed ? `<span class="delay-badge"><i class="fas fa-exclamation-triangle"></i> ${delayInfo.days}d late</span>` : ''}
            </div>
        </div>

        <div class="card-details">
            <div class="detail-item"><h4>Boat Price</h4><p>${formatCurrency(order.boatPrice)}</p></div>
            <div class="detail-item"><h4>Build Time</h4><p>${buildDuration}</p></div>
            <div class="detail-item"><h4>Estimated Delivery</h4><p style="color:#2563eb;">${formatDate(expectedDate)}</p></div>
            <div class="detail-item"><h4>Committed Date</h4><p>${formatDate(committedDate)}</p></div>
            <div class="detail-item"><h4>Actual Delivery</h4><p>${formatDate(actualDate)}</p></div>
            <div class="detail-item"><h4>Delivery Location</h4><p>${location}</p></div>
            <div class="detail-item"><h4>Contact Person</h4><p>${contact}</p></div>
            <div class="detail-item"><h4>Sea Trial</h4><p>${seaTrial}</p></div>
        </div>

        ${delayed ? `
        <div class="delay-info-box">
            <h4><i class="fas fa-exclamation-triangle"></i> Delivery Delay</h4>
            <div class="delay-details">
                <div class="dd-item"><strong>Days Delayed:</strong> ${delayInfo.days} day(s)</div>
                <div class="dd-item"><strong>Penalty Rate:</strong> ${delayInfo.percent}%</div>
                <div class="dd-item"><strong>Discount:</strong> ${formatCurrency(delayInfo.penalty)}</div>
            </div>
            ${di.delayReason ? `<div style="margin-top:8px;font-size:12px;color:#991b1b;"><strong>Reason:</strong> ${di.delayReason}</div>` : ''}
        </div>
        ` : ''}

        <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span style="color:#64748b;">Delivery Progress</span>
                <span style="font-weight:700;">${progress}%</span>
            </div>
            <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${progress}%;background:${delayed ? 'linear-gradient(90deg,#ef4444,#dc2626)' : 'linear-gradient(90deg,#356cff,#295dff)'};border-radius:3px;transition:width .4s;"></div>
            </div>
        </div>

        <div class="card-actions">
            <button class="manage-btn" onclick="openManageModal(${idx})">
                <i class="fas fa-edit"></i> Manage Delivery
            </button>
        </div>
    </div>`;
}

window.openManageModal = function(idx) {
    const order = allOrders[idx];
    if (!order) return;

    const di = order.deliveryInfo || {};
    const status = getDeliveryStatus(order);
    const delayed = isDelayed(order);
    const delayInfo = calculateDelayPenalty(order.boatPrice, di.committedDeliveryDate, di.actualDeliveryDate);
    const estimatedDate = di.expectedDate && di.expectedDate !== 'To be determined' ? di.expectedDate : getEstimatedCompletionDate(order);
    const buildDuration = getProjectDuration(order);

    const body = document.getElementById('modalBody');
    body.innerHTML = `
    <div class="modal-header">
        <div class="modal-header-icon"><i class="fas fa-truck"></i></div>
        <div class="modal-header-info">
            <h3>${order.boatName || 'Unknown'} — ${order.customerName || 'N/A'}</h3>
            <p>${order.orderId || ''} | Price: ${formatCurrency(order.boatPrice)}</p>
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
                <label>Committed Delivery Date (Promise Date)</label>
                <input type="date" id="modalCommittedDate" min="${dateToISO(estimatedDate)}" value="${di.committedDeliveryDate ? di.committedDeliveryDate.split('T')[0] : dateToISO(estimatedDate)}" onchange="window._updateActualDateMin()">
            </div>
            <div class="form-group">
                <label>Actual Delivery Date</label>
                <input type="date" id="modalActualDate" min="${di.committedDeliveryDate ? di.committedDeliveryDate.split('T')[0] : dateToISO(estimatedDate)}" value="${di.actualDeliveryDate ? di.actualDeliveryDate.split('T')[0] : ''}" onchange="window._previewPenalty()">
            </div>
        </div>
            <div class="form-row">
            <div class="form-group">
                <label>Estimated Date (from ${buildDuration} build)</label>
                <input type="text" value="${estimatedDate}" disabled style="opacity:.6;">
            </div>
            <div class="form-group">
                <label>Order Created</label>
                <input type="text" value="${order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'}) : 'N/A'}" disabled style="opacity:.6;">
            </div>
        </div>
        <div id="penaltyPreview"></div>
    </div>

    <div class="modal-section">
        <h4><i class="fas fa-location-dot"></i> Delivery Details</h4>
        <div class="form-row">
            <div class="form-group">
                <label>Delivery Location</label>
                <input type="text" id="modalLocation" value="${di.deliveryLocation || ''}" placeholder="Customer address or port">
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
            <label>Delay Reason (if delayed)</label>
            <textarea id="modalDelayReason" placeholder="Explain reason for delay...">${di.delayReason || ''}</textarea>
        </div>
        <div class="form-group">
            <label>Admin Notes</label>
            <textarea id="modalNotes" placeholder="Internal notes about this delivery...">${di.deliveryNotes || ''}</textarea>
        </div>
    </div>

    <button class="save-btn" id="saveDeliveryBtn" onclick="saveDelivery('${order.orderId}')">
        <i class="fas fa-save"></i> Save Delivery Details
    </button>
    `;

    document.getElementById('deliveryModal').classList.add('show');

    window._previewPenalty();
};

window._previewPenalty = function() {
    const committed = document.getElementById('modalCommittedDate')?.value;
    const actual = document.getElementById('modalActualDate')?.value;
    const previewEl = document.getElementById('penaltyPreview');
    if (!previewEl) return;

    if (!committed || !actual) {
        previewEl.innerHTML = '';
        return;
    }

    const a = new Date(actual);
    const c = new Date(committed);

    if (a <= c) {
        previewEl.innerHTML = `
            <div class="penalty-preview penalty-none">
                <h5><i class="fas fa-check-circle"></i> No Delay</h5>
                <div style="font-size:13px;">Delivery is on time. No penalty applies.</div>
            </div>`;
        return;
    }

    const diffMs = a - c;
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const cleanPrice = parseInt(String(currentOrderPrice() || '0').replace(/[^0-9]/g, '')) || 0;
    let percent = 0;
    if (days >= 1 && days <= 7) percent = 1;
    else if (days >= 8 && days <= 14) percent = 2;
    else if (days >= 15 && days <= 30) percent = 5;
    else if (days > 30) percent = 8;
    const penalty = Math.round(cleanPrice * (percent / 100));

    previewEl.innerHTML = `
        <div class="penalty-preview">
            <h5><i class="fas fa-exclamation-triangle"></i> Delay Penalty Preview</h5>
            <div class="penalty-amount">${formatCurrency(penalty)}</div>
            <div class="penalty-info">${days} day(s) late | ${percent}% of boat price (${formatCurrency(cleanPrice)})</div>
        </div>`;
};

function currentOrderPrice() {
    const modal = document.getElementById('modalBody');
    if (!modal) return '0';
    const priceText = modal.querySelector('.modal-header-info p')?.textContent || '';
    const match = priceText.match(/₱([\d,]+)/);
    return match ? match[1].replace(/,/g, '') : '0';
}

window.saveDelivery = async function(orderId) {
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

    try {
        let { data: { session } } = await supabase.auth.getSession();

        // Force refresh if token is about to expire or expired
        if (session?.access_token) {
            try {
                const payload = JSON.parse(atob(session.access_token.split('.')[1]));
                const expiresIn = payload.exp * 1000 - Date.now();
                console.log('[DELIVERY] Token expires in:', Math.round(expiresIn / 1000), 'seconds');
                if (expiresIn < 60000) {
                    console.log('[DELIVERY] Token near expiry, refreshing...');
                    const { data: refreshed } = await supabase.auth.refreshSession();
                    session = refreshed?.session || session;
                    console.log('[DELIVERY] Refresh result:', refreshed?.session ? 'OK' : 'FAILED');
                }
            } catch (e) {
                console.warn('[DELIVERY] Token decode failed:', e);
            }
        }

        const token = session?.access_token;
        console.log('[DELIVERY] Token present:', !!token);

        if (!token) {
            showToast('Session expired. Please log in again.', 'error');
            setTimeout(() => window.location.href = "login.html", 1500);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Save Delivery Details';
            return;
        }

        const res = await fetch(API_BASE + "/orders/" + orderId + "/delivery", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: "Bearer " + token } : {})
            },
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (!res.ok) {
            showToast(result.error || 'Failed to save delivery details', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Save Delivery Details';
            return;
        }

        // Update local order data
        const orderIdx = allOrders.findIndex(o => o.orderId === orderId);
        if (orderIdx >= 0) {
            allOrders[orderIdx] = result;
        }

        showToast('Delivery details saved successfully!', 'success');
        closeModal();
        updateStats();
        renderDeliveries();
    } catch (err) {
        console.error('[DELIVERY] Save error:', err);
        showToast('Error saving delivery: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Delivery Details';
};

window.closeModal = function() {
    document.getElementById('deliveryModal').classList.remove('show');
};

async function loadData() {
    const container = document.getElementById('deliveryContainer');

    // Fetch orders that are completed or near completion (progress >= 70)
    const { data: orders, error } = await handleDbError(
        supabase.from('boat_orders').select('*').or('status.eq.Completed,progress.gte.70'),
        'Fetch delivery orders'
    );

    if (error || !orders) {
        container.innerHTML = '<div class="loading-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load deliveries.</p></div>';
        return;
    }

    allOrders = orders.sort((a, b) => {
        const aStatus = getDeliveryStatus(a);
        const bStatus = getDeliveryStatus(b);
        const aDelayed = isDelayed(a);
        const bDelayed = isDelayed(b);
        if (aDelayed && !bDelayed) return -1;
        if (!aDelayed && bDelayed) return 1;
        const statusOrder = { 'Preparing for Delivery': 0, 'Ready for Delivery': 1, 'In Transit': 2, 'Delivered': 3 };
        return (statusOrder[aStatus] || 0) - (statusOrder[bStatus] || 0);
    });

    updateStats();
    renderDeliveries();
}

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await checkAuth();
    if (ok) loadData();
});
