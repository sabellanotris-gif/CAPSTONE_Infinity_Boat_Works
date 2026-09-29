import { supabase, handleDbError, sendEmailNotification, API_BASE, parseContractSchedule, formatScheduleDate, formatScheduleDateTime } from './supabase.js';

window.handleLogout = async function () {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "index.html";
};

// Session & role guard
(async () => {
  await window.requireRole(["admin"]);
})();

let allApprovals = [];
let activeFilter = 'all';

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

window.setApprovalFilter = function(filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('#approvalFilters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderApprovals();
};

function updateFilterCounts() {
    const scheduleCount = allApprovals.filter(a => a.type === 'schedule').length;
    const paymentCount = allApprovals.filter(a => a.type === 'payment').length;
    const schedBtn = document.querySelector('[data-filter="schedule"]');
    const payBtn = document.querySelector('[data-filter="payment"]');
    const allBtn = document.querySelector('[data-filter="all"]');
    if (schedBtn) schedBtn.innerHTML = `<i class="fas fa-calendar-check"></i> Schedule (${scheduleCount})`;
    if (payBtn) payBtn.innerHTML = `<i class="fas fa-credit-card"></i> Payment (${paymentCount})`;
    if (allBtn) allBtn.innerHTML = `All Pending (${scheduleCount + paymentCount})`;
}

function renderApprovals() {
    const container = document.getElementById('approvalsContainer');
    const emptyState = document.getElementById('emptyState');
    let filtered = allApprovals;
    if (activeFilter !== 'all') {
        filtered = allApprovals.filter(a => a.type === activeFilter);
    }

    if (filtered.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    container.innerHTML = filtered.map((a, i) => {
        const realIndex = allApprovals.indexOf(a);
        if (a.type === 'schedule') return renderScheduleCard(a, realIndex);
        return renderPaymentCard(a, realIndex);
    }).join('');
}

function renderScheduleCard(a, idx) {
    const o = a.data;
    const schedule = parseContractSchedule(o);
    const scheduleDate = schedule ? formatScheduleDateTime(schedule.date, schedule.time) : 'Not set';
    const profilePhone = a.profilePhone || '';
    const phone = o.customerPhone || profilePhone || 'N/A';
    const isCustom = o.buildType === 'custom';
    const customConfig = o.customConfig;
    const ackResponses = o.ackResponses || [];
    const ackComments = o.ackComments || {};
    const signature = schedule?.signature || o.signature || '';

    const ackLabels = [
        'I understand this is a custom-built boat and delivery timelines are estimates.',
        'I confirm the specifications and pricing discussed are accurate.',
        'I agree to the payment schedule and terms outlined.',
        'I acknowledge that delays may occur due to weather or supply issues.',
        'I understand the cancellation and refund policy.',
        'I confirm I have reviewed and agreed to the contract terms.'
    ];

    return `
    <div class="approval-card schedule-type">
        <div class="card-header">
            <div class="card-header-left">
                <div class="type-icon schedule"><i class="fas fa-calendar-check"></i></div>
                <div class="card-title">
                    <h3>${o.customerName || 'Unknown'}</h3>
                    <p>${o.orderId || ''} — ${o.boatName || 'N/A'}</p>
                </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <span class="type-badge schedule">Schedule</span>
                <span class="status-pill pending">Pending</span>
            </div>
        </div>

        <div class="card-details">
            <div class="detail-item"><h4>Boat Model</h4><p>${o.boatName || 'N/A'}</p></div>
            <div class="detail-item"><h4>Total Price</h4><p>${formatCurrency(o.boatPrice)}</p></div>
            <div class="detail-item"><h4>Payment Method</h4><p>${o.paymentMethod || 'N/A'}</p></div>
            <div class="detail-item"><h4>Build Type</h4><p>${isCustom ? 'Custom Build' : 'Standard Build'}</p></div>
        </div>

        <div class="payment-info" style="background:#f0fdf4;border-color:#bbf7d0;">
            <h4 style="color:#15803d;"><i class="fas fa-user"></i> Customer Information</h4>
            <div class="payment-amounts" style="grid-template-columns:repeat(4,1fr);">
                <div class="pa-item">
                    <span class="label">Full Name</span>
                    <span class="value" style="font-size:13px;">${o.customerName || 'N/A'}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Email</span>
                    <span class="value" style="font-size:13px;">${o.customerEmail || 'N/A'}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Phone</span>
                    <span class="value" style="font-size:13px;">${phone}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Address</span>
                    <span class="value" style="font-size:13px;">${o.customerAddress || 'N/A'}</span>
                </div>
            </div>
        </div>

        <div class="schedule-info">
            <h4><i class="fas fa-calendar-alt"></i> Proposed Contract Signing</h4>
            <div class="schedule-grid">
                <div class="sg-item"><strong>Date:</strong> ${schedule ? formatScheduleDate(schedule.date) : 'Not set'}</div>
                <div class="sg-item"><strong>Time:</strong> ${schedule?.time || 'Not set'}</div>
                <div class="sg-item"><strong>Location:</strong> ${schedule?.location || 'Not set'}</div>
                ${schedule?.notes ? `<div class="sg-item full-width"><strong>Notes:</strong> ${schedule.notes}</div>` : ''}
                ${signature ? `<div class="sg-item full-width"><strong>Signature:</strong> <span style="font-family:'Brush Script MT',cursive;font-size:18px;">${signature}</span></div>` : ''}
            </div>
        </div>

        ${ackResponses.length > 0 ? `
        <div class="payment-info" style="background:#fefce8;border-color:#fde68a;">
            <h4 style="color:#a16207;"><i class="fas fa-clipboard-check"></i> Acknowledgment Responses</h4>
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
                ${ackResponses.map((resp, i) => `
                    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
                        <span style="color:${resp === 'Yes' ? '#16a34a' : '#dc2626'};font-weight:700;min-width:28px;">${resp || '—'}</span>
                        <span style="color:#475569;">${ackLabels[i] || 'Question ' + (i + 1)}</span>
                        ${ackComments[i] ? `<span style="color:#94a3b8;margin-left:auto;">"${ackComments[i]}"</span>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        ${isCustom && customConfig ? `
        <div class="payment-info" style="background:#f5f3ff;border-color:#d8b4fe;">
            <h4 style="color:#6b21a8;"><i class="fas fa-wand-magic-sparkles"></i> Custom Configuration</h4>
            ${customConfig.boatPreviewImage ? `
            <div class="custom-boat-preview">
                <img src="${customConfig.boatPreviewImage}" alt="Custom Boat Preview" />
            </div>` : ''}
            <div class="payment-amounts" style="grid-template-columns:repeat(3,1fr);">
                ${customConfig.length ? `<div class="pa-item"><span class="label">Length</span><span class="value" style="font-size:13px;">${customConfig.length}m</span></div>` : ''}
                ${customConfig.width ? `<div class="pa-item"><span class="label">Width</span><span class="value" style="font-size:13px;">${customConfig.width}m</span></div>` : ''}
                ${customConfig.seats ? `<div class="pa-item"><span class="label">Seats</span><span class="value" style="font-size:13px;">${customConfig.seats}</span></div>` : ''}
                ${customConfig.engineName && customConfig.engineName !== 'None' ? `<div class="pa-item"><span class="label">Engine</span><span class="value" style="font-size:13px;">${customConfig.engineName}</span></div>` : ''}
                ${customConfig.ledName && customConfig.ledName !== 'None' ? `<div class="pa-item"><span class="label">LED</span><span class="value" style="font-size:13px;">${customConfig.ledName}</span></div>` : ''}
            </div>
            <div style="display:flex;gap:20px;margin-top:10px;flex-wrap:wrap;">
                ${customConfig.color ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${customConfig.color};border:2px solid #d1d5db;flex-shrink:0;"></span><span><strong>Hull:</strong> ${customConfig.hullColorName || 'N/A'}</span></div>` : ''}
                ${customConfig.deckColor ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${customConfig.deckColor};border:2px solid #d1d5db;flex-shrink:0;"></span><span><strong>Deck:</strong> ${customConfig.deckColorName || 'N/A'}</span></div>` : ''}
                ${customConfig.railColor ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${customConfig.railColor};border:2px solid #d1d5db;flex-shrink:0;"></span><span><strong>Rail:</strong> ${customConfig.railColorName || 'N/A'}</span></div>` : ''}
            </div>
            ${customConfig.items && customConfig.items.length > 0 ? `
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px;padding-top:10px;border-top:1px solid #e9d5ff;">
                <div style="font-size:11px;font-weight:700;color:#6b21a8;text-transform:uppercase;margin-bottom:2px;">Price Breakdown</div>
                ${customConfig.items.map(i => `<div style="font-size:12px;color:#475569;display:flex;justify-content:space-between;"><span>${i.name}</span><span>₱${Number(i.amount || 0).toLocaleString()}</span></div>`).join('')}
                ${customConfig.totalPrice ? `<div style="font-size:13px;font-weight:800;color:#6b21a8;display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #e9d5ff;"><span>Total</span><span>${customConfig.totalPrice}</span></div>` : ''}
            </div>` : ''}
        </div>
        ` : ''}

        <div class="card-actions">
            <button class="approve-btn" onclick="approveScheduleApproval(${idx})">
                <i class="fas fa-check"></i> Approve Schedule
            </button>
            <button class="reject-btn" onclick="rejectScheduleApproval(${idx})">
                <i class="fas fa-times"></i> Reject Schedule
            </button>
        </div>
    </div>`;
}

function renderPaymentCard(a, idx) {
    const p = a.data;
    const o = a.order || {};
    const boatPrice = parseAmount(o.boatPrice);
    const amountPaid = parseAmount(p.amount);
    const remaining = parseAmount(o.remainingBalance);
    const isFullPayment = (o.paymentMethod || '').toLowerCase() === 'full payment';
    const currentStep = o.paymentStep || 0;
    const totalSteps = isFullPayment ? 1 : 3;
    const phaseLabel = isFullPayment ? 'Full Payment' : (p.phase || ('Phase ' + (currentStep + 1)));
    const profilePhone = a.profilePhone || '';
    const phone = o.customerPhone || profilePhone || 'N/A';

    return `
    <div class="approval-card payment-type">
        <div class="card-header">
            <div class="card-header-left">
                <div class="type-icon payment"><i class="fas fa-credit-card"></i></div>
                <div class="card-title">
                    <h3>${p.customerName || o.customerName || 'Unknown'}</h3>
                    <p>${o.boatName || 'N/A'} — ${p.orderId || o.orderId || ''}</p>
                    <p style="font-size:11px;color:#64748b;margin-top:2px;"><i class="fas fa-phone"></i> ${phone}</p>
                </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <span class="type-badge payment">Payment</span>
                <span class="status-pill pending">Pending</span>
            </div>
        </div>

        <div class="card-details">
            <div class="detail-item"><h4>Boat Model</h4><p>${o.boatName || 'N/A'}</p></div>
            <div class="detail-item"><h4>Total Price</h4><p>${formatCurrency(boatPrice)}</p></div>
            <div class="detail-item"><h4>Payment Method</h4><p>${o.paymentMethod || 'N/A'}</p></div>
            <div class="detail-item"><h4>Remaining</h4><p>${formatCurrency(remaining)}</p></div>
        </div>

        <div class="payment-info">
            <h4><i class="fas fa-money-bill-wave"></i> Payment Details</h4>
            <div class="payment-amounts">
                <div class="pa-item">
                    <span class="label">Amount Submitted</span>
                    <span class="value highlight">${formatCurrency(amountPaid)}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Phase</span>
                    <span class="value">${phaseLabel}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Remaining</span>
                    <span class="value">${formatCurrency(remaining)}</span>
                </div>
            </div>
        </div>

        <div class="payment-info" style="background:#f0fdf4;border-color:#bbf7d0;">
            <h4 style="color:#15803d;"><i class="fas fa-university"></i> Transaction Info</h4>
            <div class="payment-amounts">
                <div class="pa-item">
                    <span class="label">Bank</span>
                    <span class="value" style="font-size:13px;">${p.bank || 'N/A'}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Reference #</span>
                    <span class="value" style="font-size:13px;">${p.reference || 'N/A'}</span>
                </div>
                <div class="pa-item">
                    <span class="label">Account Name</span>
                    <span class="value" style="font-size:13px;">${p.accountName || 'N/A'}</span>
                </div>
            </div>
            <div style="margin-top:8px;font-size:12px;color:#64748b;">
                ${p.accountNumber ? `<span><strong>Account #:</strong> ${p.accountNumber}</span>` : ''}
                ${p.submittedDate || p.createdAt ? `<span style="margin-left:12px;"><strong>Submitted:</strong> ${new Date(p.submittedDate || p.createdAt).toLocaleString('en-PH')}</span>` : ''}
            </div>
        </div>

        ${(p.proofImage || p.paymentProof) ? `
        <div class="payment-info" style="background:#fefce8;border-color:#fde68a;">
            <h4 style="color:#a16207;"><i class="fas fa-image"></i> Proof of Payment</h4>
            <div style="margin-top:8px;text-align:center;">
                <img src="${p.proofImage || p.paymentProof}" alt="Proof of Payment" 
                     style="max-width:100%;max-height:320px;border-radius:12px;border:2px solid #fde68a;cursor:pointer;object-fit:contain;"
                     onclick="window.open('${p.proofImage || p.paymentProof}', '_blank')" />
            </div>
        </div>
        ` : ''}

        <div class="card-actions">
            <button class="approve-btn" onclick="approvePaymentApproval(${idx})">
                <i class="fas fa-check"></i> Approve Payment
            </button>
            <button class="reject-btn" onclick="rejectPaymentApproval(${idx})">
                <i class="fas fa-times"></i> Reject Payment
            </button>
        </div>
    </div>`;
}

async function loadData() {
    const container = document.getElementById('approvalsContainer');
    allApprovals = [];

    // 1. Fetch orders with Pending Signing status (schedule needs approval)
    const { data: pendingOrders, error: ordErr } = await handleDbError(
        supabase.from('boat_orders').select('*').in('status', ['Pending Signing', 'Pending']),
        'Fetch pending orders'
    );

    // 2. Fetch custom orders with "Approved" status and "Custom Design Approved" phase (schedule needs admin review)
    const { data: customDesignApproved, error: custErr } = await handleDbError(
        supabase.from('boat_orders').select('*').eq('status', 'Approved').eq('orderPhase', 'Custom Design Approved'),
        'Fetch custom design approved orders'
    );

    const allScheduleOrders = [
        ...(pendingOrders || []),
        ...(customDesignApproved || [])
    ];

    // 2. Fetch pending payments
    const { data: pendingPayments, error: payErr } = await handleDbError(
        supabase.from('dashboard_payments').select('*').eq('status', 'Pending'),
        'Fetch pending payments'
    );

    let orderMap = {};
    if (!payErr && pendingPayments && pendingPayments.length > 0) {
        // Fetch related orders for each payment
        const orderIds = [...new Set(pendingPayments.map(p => p.orderId).filter(Boolean))];
        if (orderIds.length > 0) {
            const { data: relatedOrders } = await supabase.from('boat_orders').select('*').in('orderId', orderIds);
            if (relatedOrders) {
                relatedOrders.forEach(o => { orderMap[o.orderId] = o; });
            }
        }
    }

    // Fetch profiles for phone numbers (both schedule + payment orders)
    const allOrderUsers = [
        ...allScheduleOrders.map(o => o.userId),
        ...Object.values(orderMap).map(o => o.userId)
    ];
    const userIds = [...new Set(allOrderUsers.filter(Boolean))];
    let profileMap = {};
    if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, phone').in('id', userIds);
        if (profiles) {
            profiles.forEach(p => { profileMap[p.id] = p; });
        }
    }

    if ((!ordErr && pendingOrders) || (!custErr && customDesignApproved)) {
        for (const o of allScheduleOrders) {
            allApprovals.push({ type: 'schedule', data: o, id: o.orderId, profilePhone: profileMap[o.userId]?.phone || '' });
        }
    }

    if (!payErr && pendingPayments && pendingPayments.length > 0) {
        for (const p of pendingPayments) {
            const order = orderMap[p.orderId] || {};
            allApprovals.push({ type: 'payment', data: p, order, id: p.id, profilePhone: profileMap[order.userId]?.phone || '' });
        }
    }

    updateFilterCounts();
    renderApprovals();
}

// Schedule Approval
window.approveScheduleApproval = async function(idx) {
    const a = allApprovals[idx];
    if (!a || a.type !== 'schedule') return;
    if (!confirm('Approve this contract signing schedule? The customer will be notified and can proceed to payment.')) return;

    const order = a.data;
    const result = await handleDbError(
        supabase.from('boat_orders').update({
            status: 'Approved',
            progress: 0,
            orderPhase: 'Contract Signed - Awaiting Payment'
        }).eq('orderId', order.orderId),
        'Approve schedule'
    );

    if (result?.error) return;

    sendEmailNotification({ type: 'status_changed', recipient: order.customerEmail, data: order });
    showToast('Schedule approved! Use Create Team in the Boat Progress page.', 'success');
    loadData();
};

window.rejectScheduleApproval = async function(idx) {
    const a = allApprovals[idx];
    if (!a || a.type !== 'schedule') return;
    const reason = prompt('Enter reason for rejecting the schedule:');
    if (reason === null) return;
    if (!reason.trim()) { alert('Please provide a reason.'); return; }

    const order = a.data;
    const result = await handleDbError(
        supabase.from('boat_orders').update({
            status: 'Schedule Rejected',
            orderPhase: 'Schedule Rejected',
            reviewFeedback: reason.trim()
        }).eq('orderId', order.orderId),
        'Reject schedule'
    );

    if (result?.error) return;

    sendEmailNotification({ type: 'status_changed', recipient: order.customerEmail, data: order });
    showToast('Schedule rejected. Customer has been notified.', 'info');
    loadData();
};

// Payment Approval
window.assignTeamForOrder = async function(orderId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(API_BASE + "/workers/assign-team/" + orderId, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, msg: data?.error || "Team assignment failed" };
        return { ok: true, count: data?.count || 0, skipped: data?.skipped || [] };
    } catch (e) {
        console.error("Assign team failed:", e);
        return { ok: false, msg: e?.message || "Team assignment failed" };
    }
};

window.approvePaymentApproval = async function(idx) {
    const a = allApprovals[idx];
    if (!a || a.type !== 'payment') return;
    if (!confirm('Approve this payment?')) return;

    const payment = a.data;

    // Update payment status
    const result = await handleDbError(
        supabase.from('dashboard_payments').update({ status: 'Approved' }).eq('id', payment.id),
        'Approve payment'
    );

    if (result?.error) return;

    // Re-fetch order fresh from DB (like dashpayment.js does)
    const ordersRes = await supabase.from('boat_orders').select('*').eq('orderId', payment.orderId);
    if (ordersRes.error || !ordersRes.data || ordersRes.data.length === 0) {
        showToast('Payment approved but order not found. Skipping order update.', 'info');
        loadData();
        return;
    }
    const order = ordersRes.data[0];
    const currentStep = order.paymentStep || 0;
    const nextStep = currentStep + 1;
    const cleanPrice = parseAmount(order.boatPrice);
    const isFullPayment = (order.paymentMethod || '').toLowerCase() === 'full payment';
    const phaseAmounts = isFullPayment ? [cleanPrice, 0, 0] : [cleanPrice * 0.30, cleanPrice * 0.40, cleanPrice * 0.30];
    let paidSoFar = phaseAmounts.slice(0, nextStep).reduce((a, b) => a + b, 0);

    const newRemaining = Math.max(0, cleanPrice - paidSoFar);
    const oldHistory = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
    const paymentHistory = [...oldHistory, {
        phase: isFullPayment ? 'Full Payment' : (payment.phase || ('Phase ' + (currentStep + 1))),
        amount: parseAmount(payment.amount),
        date: new Date().toISOString(),
        status: 'Approved',
        reference: payment.reference || '',
        bank: payment.bank || ''
    }];

    const updateData = {
        paymentStep: nextStep,
        remainingBalance: newRemaining,
        paymentHistory: paymentHistory
    };

    if (currentStep === 0 && nextStep === 1) {
        updateData.progress = 10;
        updateData.orderPhase = 'Boat Construction Started';
    }

    console.log('[APPROVE] Updating order:', order.orderId, 'data:', JSON.stringify(updateData));

    const updateResult = await handleDbError(
        supabase.from('boat_orders').update(updateData).eq('orderId', order.orderId),
        'Update order payment'
    );

    console.log('[APPROVE] Update result:', updateResult);

    if (currentStep === 0 && nextStep === 1) {
        const teamRes = await window.assignTeamForOrder(order.orderId);
        if (teamRes.ok) {
            const skippedBusy = (teamRes.skipped || []).length;
            if (teamRes.count === 0 && skippedBusy) {
                showToast('Payment approved. No assignments created — ' + skippedBusy + ' specialty(ies) had no available worker. Use Create Team in Boat Progress.', 'warning');
            } else {
                showToast('Payment approved. Build team created with ' + teamRes.count + ' assignment(s).' + (skippedBusy ? ' ' + skippedBusy + ' specialty(ies) skipped (no available worker).' : ''), 'success');
            }
        } else {
            showToast('Payment approved, but team was not created: ' + teamRes.msg + ' Use Create Team in Boat Progress.', 'warning');
        }
    }

    sendEmailNotification({ type: 'payment_approved', recipient: payment.customerEmail || order.customerEmail, data: payment });
    showToast('Payment approved successfully!', 'success');
    loadData();
};

window.rejectPaymentApproval = async function(idx) {
    const a = allApprovals[idx];
    if (!a || a.type !== 'payment') return;
    const reason = prompt('Enter reason for rejecting this payment:');
    if (reason === null) return;
    if (!reason.trim()) { alert('Please provide a reason.'); return; }

    const payment = a.data;

    const result = await handleDbError(
        supabase.from('dashboard_payments').update({
            status: 'Rejected',
            rejectionReason: reason.trim()
        }).eq('id', payment.id),
        'Reject payment'
    );

    if (result?.error) return;

    sendEmailNotification({ type: 'payment_rejected', recipient: payment.customerEmail || a.order?.customerEmail, data: { ...payment, rejectionReason: reason.trim() } });
    showToast('Payment rejected. Customer has been notified.', 'info');
    loadData();
};

// Modal
window.closeModal = function() {
    document.getElementById('approvalModal').classList.remove('show');
};

document.addEventListener('DOMContentLoaded', loadData);
