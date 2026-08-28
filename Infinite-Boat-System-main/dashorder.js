import { supabase, handleDbError, sendEmailNotification, API_BASE } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

// Session & role guard
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
  if (!profile || profile.role !== "admin") { window.location.href = "login.html"; return; }
})();

function safeNum(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[₱,$,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

let orders = [];
let profilePhoneMap = {};
const ordersGrid = document.getElementById('ordersGrid');
const totalOrders = document.getElementById('totalOrders');
const pendingOrders = document.getElementById('pendingOrders');
const approvedOrders = document.getElementById('approvedOrders');
const completedOrders = document.getElementById('completedOrders');

let revisionTargetIndex = -1;

function renderOrders(filter) {
    if (!ordersGrid) return;

    let displayOrders = orders;
    if (filter && filter !== 'All') {
        displayOrders = orders.filter(o => o.status === filter);
    }

    ordersGrid.innerHTML = '';
    updateSummary();

    if (displayOrders.length === 0) {
        ordersGrid.innerHTML = '<div class="empty-orders"><h2>No Orders Found</h2><p>Waiting for customer submissions.</p></div>';
        return;
    }

    displayOrders.forEach((order) => {
        const realIndex = orders.indexOf(order);
        const statusClass = getStatusClass(order.status);
        const isCustom = order.buildType === 'custom';
        const isUnderReview = order.status === 'Under Review';
        const isPendingSigning = order.status === 'Pending Signing';
        const isCancellationRequested = order.status === 'Cancellation Requested';
        const isCancelled = order.status === 'Cancelled';
        const schedule = window.parseContractSchedule(order);

        const safeImg = order.boatImage || './images/boat1.jpg';
        const safeName = order.boatName || 'Boat';
        const safeCustomer = order.customerName || 'Unknown';
        const safePayment = order.paymentMethod || 'N/A';
        const safeBuildTime = order.buildTime || 'N/A';
        const safeProgress = order.progress || 0;
        ordersGrid.innerHTML += `
        <div class="order-card">
            <img src="${safeImg}" alt="Boat">
            <div class="order-info">
                <div class="order-top">
                    <div>
                        <h2>${safeName}</h2>
                        <p class="customer-name">Customer: ${safeCustomer}</p>
                        ${isCustom ? '<span class="custom-badge">CUSTOM BUILD</span>' : ''}
                    </div>
                    <span class="status ${statusClass}">${order.status}</span>
                </div>
                <div class="order-details">
                    <div><h4>Price</h4><p>₱${safeNum(order.boatPrice).toLocaleString()}</p></div>
                    <div><h4>Payment</h4><p>${safePayment}</p></div>
                    <div><h4>Build Time</h4><p>${safeBuildTime}</p></div>
                    <div><h4>Remaining</h4><p>₱${safeNum(order.remainingBalance).toLocaleString()}</p></div>
                </div>
                <div class="progress-area">
                    <div class="progress-top"><span>Progress</span><span>${safeProgress}%</span></div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${safeProgress}%"></div></div>
                </div>
                ${isCustom && order.customConfig ? `
                <div class="config-panel">
                    <h3><i class="fa-solid fa-gear"></i> CUSTOM CONFIGURATION</h3>
                    <div class="config-grid">
                        <span>Length: ${order.customConfig.length || 'N/A'}m</span>
                        <span>Width: ${order.customConfig.width || 'N/A'}m</span>
                        ${order.customConfig.items ? order.customConfig.items.map(i => `
                        <span>${i.name}: ₱${safeNum(i.amount).toLocaleString()}</span>
                        `).join('') : `
                        <span>Engine: ₱${safeNum(order.customConfig.engine).toLocaleString()}</span>
                        <span>Seats: ${order.customConfig.seats || 'N/A'}</span>
                        <span>LED: ₱${safeNum(order.customConfig.led).toLocaleString()}</span>
                        `}
                        <span>Hull Color: ${order.customConfig.hullColorName || order.customConfig.color || 'N/A'}</span>
                        <span>Deck Color: ${order.customConfig.deckColorName || 'N/A'}</span>
                        <span>Rail Color: ${order.customConfig.railColorName || 'N/A'}</span>
                    </div>
                </div>` : ''}
                ${schedule ? `
                <div class="schedule-panel">
                    <h3><i class="fa-solid fa-calendar-check"></i> CONTRACT SIGNING SCHEDULE</h3>
                    <div class="schedule-grid">
                        <span>Date: ${window.formatScheduleDateTime(schedule.date, schedule.time)}</span>
                        <span>Location: ${schedule.location || 'N/A'}</span>
                        ${schedule.notes ? `<span class="full-width">Notes: ${schedule.notes}</span>` : ''}
                    </div>
                </div>` : ''}
                ${order.reviewFeedback ? `
                <div class="feedback-panel warning">
                    <h4><i class="fa-solid fa-pen"></i> REVISION FEEDBACK</h4>
                    <p>${order.reviewFeedback}</p>
                </div>` : ''}
                ${isCancellationRequested && !order.cancelPaidAt ? `
                <div class="feedback-panel danger">
                    <h4><i class="fa-solid fa-triangle-exclamation"></i> CANCELLATION REQUESTED</h4>
                    <p><strong>Previous Status:</strong> ${order.previousStatus || "N/A"}</p>
                    <p><strong>Reason:</strong> ${order.cancelReason || "N/A"}</p>
                    <p><strong>Signed by:</strong> ${order.cancelSignature || "N/A"}</p>
                    ${order.cancelFee ? `<p class="fee-label"><strong>Cancellation Fee:</strong> ₱${safeNum(order.cancelFee).toLocaleString()}</p>` : '<p class="no-fee"><strong>No cancellation fee</strong></p>'}
                    ${order.cancelMaterials ? `
                    <div class="materials-list">
                        <strong>Materials allocated:</strong>
                        <ul>${order.cancelMaterials.map(m => '<li>' + m + '</li>').join('')}</ul>
                    </div>` : ''}
                </div>` : isCancellationRequested && order.cancelPaidAt ? `
                <div class="feedback-panel muted">
                    <h4><i class="fa-solid fa-check-circle"></i> CANCELLATION FEE PAID — AUTO-CANCELLED</h4>
                    <p><strong>Reason:</strong> ${order.cancelReason || "N/A"}</p>
                    <p><strong>Signed by:</strong> ${order.cancelSignature || "N/A"}</p>
                    ${order.cancelFee ? `<p class="fee-label"><strong>Cancellation Fee Paid:</strong> ₱${safeNum(order.cancelFee).toLocaleString()}</p>` : ''}
                    <p class="fee-paid"><strong>Paid At:</strong> ${new Date(order.cancelPaidAt).toLocaleString()}</p>
                    <p style="margin-top:8px;color:#64748b;font-size:12px;">This order was automatically cancelled after the customer paid the cancellation fee.</p>
                </div>` : isCancelled ? `
                <div class="feedback-panel muted">
                    <h4><i class="fa-solid fa-ban"></i> CANCELLED</h4>
                    <p><strong>Reason:</strong> ${order.cancelReason || "N/A"}</p>
                    <p><strong>Signed by:</strong> ${order.cancelSignature || "N/A"}</p>
                    ${order.cancelFee ? `<p class="fee-label"><strong>Cancellation Fee:</strong> ₱${safeNum(order.cancelFee).toLocaleString()}</p>` : ''}
                    ${order.cancelPaidAt ? `<p class="fee-paid"><strong>Fee Paid At:</strong> ${new Date(order.cancelPaidAt).toLocaleString()}</p>` : ''}
                </div>` : ''}
                ${order.cancelRejectFeedback ? `
                <div class="feedback-panel success">
                    <h4>Cancellation Rejected</h4>
                    <p>${order.cancelRejectFeedback}</p>
                </div>` : ''}
                <div class="actions">
                    ${isCancellationRequested && !order.cancelPaidAt ? `
                        <button class="approve-btn" onclick="approveCancellation(${realIndex})"><i class="fa-solid fa-check"></i> Approve Cancellation</button>
                        <button class="reject-btn" onclick="rejectCancellation(${realIndex})"><i class="fa-solid fa-times"></i> Reject Cancellation</button>
                    ` : isUnderReview ? `
                        <button class="approve-btn" onclick="approveCustom(${realIndex})"><i class="fa-solid fa-check"></i> Approve Design</button>
                        <button class="revision-btn" onclick="requestRevision(${realIndex})"><i class="fa-solid fa-pen"></i> Request Revision</button>
                    ` : isPendingSigning ? `
                        <button class="approve-btn" onclick="approveSchedule(${realIndex})"><i class="fa-solid fa-check"></i> Approve Schedule</button>
                        <button class="revision-btn" onclick="rejectSchedule(${realIndex})"><i class="fa-solid fa-pen"></i> Reject Schedule</button>
                    ` : (order.status === 'Pending' || order.status === 'Revision Required') ? `
                        <button class="approve-btn" onclick="approveOrder(${realIndex})"><i class="fa-solid fa-check"></i> Approve</button>
                        <button class="revision-btn" onclick="requestRevision(${realIndex})"><i class="fa-solid fa-pen"></i> Request Revision</button>
                    ` : ''}
                    <button class="view-btn" onclick="viewOrder(${realIndex})"><i class="fa-solid fa-eye"></i> View</button>
                    ${(order.status === 'Approved' && order.progress < 100) ? `<button class="progress-btn" onclick="updateProgress(${realIndex})"><i class="fa-solid fa-arrow-up"></i> + Progress</button>` : ''}
                </div>
            </div>
        </div>`;
    });
}

function getStatusClass(status) {
    if (status === 'Approved' || status === 'Completed') return 'approved';
    if (status === 'Rejected' || status === 'Schedule Rejected') return 'rejected';
    if (status === 'Cancelled') return 'rejected';
    return 'pending';
}

async function decrementInventory(itemId, qty) {
  if (!itemId) return;
  const { data } = await supabase.from("inventory").select("stock").eq("id", itemId).single();
  if (data) {
    await supabase.from("inventory").update({ stock: Math.max(0, data.stock - qty) }).eq("id", itemId);
  }
}

async function approveOrder(index) {
    const order = orders[index];
    const oldStatus = order.status;
    const isInstallment = (order.paymentMethod || '').toLowerCase() === 'installment';
    order.status = 'Approved';
    order.progress = 0;
    order.orderPhase = 'Boat Construction Started';
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: "Approved", progress: 0, orderPhase: "Boat Construction Started" }).eq("orderId", order.orderId),
        "Approve order"
    );
    if (result?.error) {
        order.status = oldStatus; order.progress = 0; order.orderPhase = oldStatus;
        return;
    }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    showToast('Order Approved Successfully', 'success');
    renderOrders(getActiveFilter());
}

async function requestRevisionModal(index) {
    revisionTargetIndex = index;
    document.getElementById('revisionFeedback').value = '';
    document.getElementById('revisionModal').classList.add('show');
}

async function approveCancellation(index) {
    if (!confirm('Approve this cancellation request? This will permanently cancel the order.')) return;
    const order = orders[index];
    const oldStatus = order.status;
    order.previousStatus = order.status;
    order.status = 'Cancelled';
    order.orderPhase = 'Cancelled';
    order.progress = 0;
    order.cancelApprovedAt = new Date().toISOString();
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: "Cancelled", orderPhase: "Cancelled", progress: 0, cancelApprovedAt: new Date().toISOString() }).eq("orderId", order.orderId),
        "Approve cancellation"
    );
    if (result?.error) { order.status = oldStatus; order.orderPhase = oldStatus; return; }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    showToast('Cancellation approved. Order has been cancelled.', 'success');
    renderOrders(getActiveFilter());
}

async function rejectCancellation(index) {
    const feedback = prompt('Enter reason for rejecting the cancellation request:');
    if (feedback === null) return;
    if (!feedback.trim()) { alert('Please provide a reason.'); return; }
    const order = orders[index];
    const oldStatus = order.status;
    const prevStatus = order.previousStatus || 'Pending';
    order.status = prevStatus;
    order.cancelRejectFeedback = feedback.trim();
    order.cancelRejectedAt = new Date().toISOString();
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: prevStatus, cancelRejectFeedback: feedback.trim(), cancelRejectedAt: new Date().toISOString() }).eq("orderId", order.orderId),
        "Reject cancellation"
    );
    if (result?.error) { order.status = oldStatus; return; }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    alert('Cancellation request rejected. Order returned to "' + prevStatus + '" status.');
    renderOrders(getActiveFilter());
}

async function approveCustom(index) {
    const order = orders[index];
    const oldStatus = order.status;
    order.status = 'Approved';
    order.progress = 0;
    order.orderPhase = 'Custom Design Approved';
    order.reviewFeedback = '';
    order.reviewStatus = 'approved';
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: "Approved", progress: 0, orderPhase: "Custom Design Approved", reviewFeedback: "", reviewStatus: "approved" }).eq("orderId", order.orderId),
        "Approve custom design"
    );
    if (result?.error) { order.status = oldStatus; return; }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    // Deduct customization parts from inventory
    if (order.customConfig) {
      if (order.customConfig.engineItem) await decrementInventory(order.customConfig.engineItem, 1);
      if (order.customConfig.ledItem) await decrementInventory(order.customConfig.ledItem, 1);
    }
    showToast('Custom design approved! Customer can now proceed to finalize the order.', 'success');
    renderOrders(getActiveFilter());
}

async function requestRevision(index) {
    revisionTargetIndex = index;
    document.getElementById('revisionFeedback').value = '';
    document.getElementById('revisionModal').classList.add('show');
}

async function approveSchedule(index) {
    if (!confirm('Approve this contract signing schedule? The customer will be notified and can proceed to payment.')) return;
    const order = orders[index];
    const oldStatus = order.status;
    order.status = 'Approved';
    order.progress = 0;
    order.orderPhase = 'Contract Signed - Awaiting Payment';
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: "Approved", progress: 0, orderPhase: "Contract Signed - Awaiting Payment" }).eq("orderId", order.orderId),
        "Approve schedule"
    );
    if (result?.error) { order.status = oldStatus; return; }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    showToast('Schedule approved! Assign workers in the Manage Progress page.', 'success');
    renderOrders(getActiveFilter());
}

async function rejectSchedule(index) {
    const reason = prompt('Enter reason for rejecting the schedule:');
    if (reason === null) return;
    if (!reason.trim()) { alert('Please provide a reason.'); return; }
    const order = orders[index];
    const oldStatus = order.status;
    order.status = 'Schedule Rejected';
    order.orderPhase = 'Schedule Rejected';
    order.reviewFeedback = reason.trim();
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: "Schedule Rejected", orderPhase: "Schedule Rejected", reviewFeedback: reason.trim() }).eq("orderId", order.orderId),
        "Reject schedule"
    );
    if (result?.error) { order.status = oldStatus; return; }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    alert('Schedule rejected. Customer will be notified with the reason.');
    renderOrders(getActiveFilter());
}

document.getElementById('submitRevisionBtn').addEventListener('click', async () => {
    if (revisionTargetIndex < 0 || revisionTargetIndex >= orders.length) {
        alert('No order selected for revision.');
        return;
    }
    const feedback = document.getElementById('revisionFeedback').value.trim();
    if (!feedback) {
        alert('Please provide revision feedback.');
        return;
    }
    const order = orders[revisionTargetIndex];
    const oldStatus = order.status;
    order.status = 'Revision Required';
    order.orderPhase = 'Revision Requested';
    order.reviewFeedback = feedback;
    order.reviewStatus = 'revision';
    const result = await handleDbError(
        supabase.from("boat_orders").update({ status: "Revision Required", orderPhase: "Revision Requested", reviewFeedback: feedback, reviewStatus: "revision" }).eq("orderId", order.orderId),
        "Submit revision"
    );
    if (result?.error) { order.status = oldStatus; return; }
    sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    document.getElementById('revisionModal').classList.remove('show');
    showToast('Revision request sent to customer.', 'info');
    renderOrders(getActiveFilter());
});

document.getElementById('closeRevisionModal').addEventListener('click', () => {
    document.getElementById('revisionModal').classList.remove('show');
});

document.getElementById('revisionModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('revisionModal')) {
        document.getElementById('revisionModal').classList.remove('show');
    }
});

function viewOrder(index) {
    const order = orders[index];
    const modal = document.getElementById('viewModal');
    const body = document.getElementById('modalBody');
    const price = '₱' + safeNum(order.boatPrice || 0).toLocaleString();
    const remaining = '₱' + safeNum(order.remainingBalance || 0).toLocaleString();

    let html = `
    <div class="view-grid">
        <div><strong>Customer</strong><p>${order.customerName || 'N/A'}</p></div>
        <div><strong>Email</strong><p>${order.customerEmail || 'N/A'}</p></div>
        <div><strong>Phone</strong><p>${order.customerPhone || profilePhoneMap[order.userId]?.phone || 'N/A'}</p></div>
        <div><strong>Address</strong><p>${order.customerAddress || 'N/A'}</p></div>
        <div><strong>Boat Name</strong><p>${order.boatName || 'N/A'}</p></div>
        <div><strong>Price</strong><p>${price}</p></div>
        <div><strong>Payment Method</strong><p>${order.paymentMethod || 'N/A'}</p></div>
        <div><strong>Remaining Balance</strong><p>${remaining}</p></div>
        <div><strong>Status</strong><p><span class="status ${getStatusClass(order.status)}">${order.status}</span></p></div>
        <div><strong>Progress</strong><p>${order.progress || 0}%</p></div>
        <div><strong>Phase</strong><p>${order.orderPhase || 'N/A'}</p></div>
        <div><strong>Build Type</strong><p>${order.buildType === 'custom' ? 'Custom Build' : 'Standard Build'}</p></div>
    </div>`;

    const parsedSchedule = window.parseContractSchedule(order);
    if (parsedSchedule) {
        html += '<hr><h4 class="section-title blue"><i class="fa-solid fa-calendar-check"></i> CONTRACT SIGNING</h4><div class="view-grid">';
        html += '<div class="full-width"><strong>Scheduled</strong><p>' + window.formatScheduleDateTime(parsedSchedule.date, parsedSchedule.time) + '</p></div>';
        html += '<div class="full-width"><strong>Location</strong><p>' + (parsedSchedule.location || 'N/A') + '</p></div>';
        if (parsedSchedule.notes) html += '<div class="full-width"><strong>Notes</strong><p>' + parsedSchedule.notes + '</p></div>';
        if (parsedSchedule.signature) html += '<div class="full-width"><strong>Digital Signature</strong><p class="signature-text">' + parsedSchedule.signature + '</p></div>';
        else if (order.signature) html += '<div class="full-width"><strong>Digital Signature</strong><p class="signature-text">' + order.signature + '</p></div>';
        html += '</div>';
    }

    if (order.customConfig) {
        html += '<hr><h4 class="section-title purple"><i class="fa-solid fa-gear"></i> CUSTOM CONFIGURATION</h4><div class="view-grid">';
        html += '<div><strong>Length</strong><p>' + (order.customConfig.length || 'N/A') + 'm</p></div>';
        html += '<div><strong>Width</strong><p>' + (order.customConfig.width || 'N/A') + 'm</p></div>';
        if (order.customConfig.items) {
            order.customConfig.items.forEach(i => {
                html += '<div><strong>' + i.name + '</strong><p>₱' + safeNum(i.amount).toLocaleString() + '</p></div>';
            });
        } else {
            html += '<div><strong>Engine</strong><p>₱' + safeNum(order.customConfig.engine).toLocaleString() + '</p></div>';
            html += '<div><strong>Seats</strong><p>' + (order.customConfig.seats || 'N/A') + '</p></div>';
            html += '<div><strong>LED</strong><p>₱' + safeNum(order.customConfig.led).toLocaleString() + '</p></div>';
        }
        html += '<div><strong>Hull Color</strong><p>' + (order.customConfig.hullColorName || order.customConfig.color || 'N/A') + '</p></div>';
        html += '<div><strong>Deck Color</strong><p>' + (order.customConfig.deckColorName || 'N/A') + '</p></div>';
        html += '<div><strong>Rail Color</strong><p>' + (order.customConfig.railColorName || 'N/A') + '</p></div>';
        html += '</div>';
    }

    if (order.reviewFeedback) {
        html += '<hr><h4 class="section-title amber"><i class="fa-solid fa-pen"></i> REVIEW FEEDBACK</h4><div class="feedback-box">' + order.reviewFeedback + '</div>';
    }

    if (order.status === 'Cancelled' || order.status === 'Cancellation Requested') {
        html += '<hr><h4 class="section-title red"><i class="fa-solid fa-ban"></i> CANCELLATION DETAILS</h4><div class="view-grid">';
        html += '<div><strong>Reason</strong><p>' + (order.cancelReason || 'N/A') + '</p></div>';
        html += '<div><strong>Signed by</strong><p>' + (order.cancelSignature || 'N/A') + '</p></div>';
        if (order.cancelFee) html += '<div><strong>Cancellation Fee</strong><p>₱' + safeNum(order.cancelFee).toLocaleString() + '</p></div>';
        if (order.cancelPaidAt) html += '<div><strong>Fee Paid At</strong><p>' + new Date(order.cancelPaidAt).toLocaleString() + '</p></div>';
        if (order.cancelApprovedAt) html += '<div><strong>Cancelled At</strong><p>' + new Date(order.cancelApprovedAt).toLocaleString() + '</p></div>';
        if (order.cancelRejectFeedback) html += '<div class="full-width"><strong>Rejection Feedback</strong><div class="feedback-box success">' + order.cancelRejectFeedback + '</div></div>';
        html += '</div>';
    }

    body.innerHTML = html;
    modal.classList.add('show');
}

document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('viewModal').classList.remove('show');
});
document.getElementById('viewModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('viewModal')) {
        document.getElementById('viewModal').classList.remove('show');
    }
});

async function updateProgress(index) {
    const order = orders[index];
    if (order.status !== 'Approved') {
        alert('Approve order first.');
        return;
    }
    const input = prompt('Enter progress percentage (0-100):', (order.progress || 0) + 10);
    if (input === null) return;
    let progress = parseInt(input);
    if (isNaN(progress) || progress < 0) { alert('Invalid value.'); return; }
    if (progress > 100) progress = 100;

    const gates = { 0: 0, 1: 40, 2: 75, 3: 100 };
    const maxProgress = gates[order.paymentStep || 0] || 0;
    if (progress > maxProgress) {
      const needed = maxProgress === 0 ? "Downpayment" : maxProgress === 40 ? "Mid-Construction Payment" : "Final Payment";
      alert("Cannot advance beyond " + maxProgress + "%. Complete " + needed + " first.");
      return;
    }
    if (progress >= 100 && Number(order.remainingBalance || 0) > 0) {
      alert("Order must be fully paid before completion.");
      return;
    }

    const oldProgress = order.progress;
    const oldStatus = order.status;
    order.progress = progress;
    if (progress >= 100) {
        order.status = 'Completed';
        order.orderPhase = 'Completed';
    } else if (progress >= 70) {
        order.orderPhase = 'Painting & Finishing';
    } else if (progress >= 45) {
        order.orderPhase = 'Interior Installation';
    } else if (progress >= 25) {
        order.orderPhase = 'Engine Assembly';
    } else {
        order.orderPhase = 'Hull Construction';
    }
    const updateData = { progress, orderPhase: order.orderPhase };
    if (progress >= 100) updateData.status = "Completed";
    const result = await handleDbError(
        supabase.from("boat_orders").update(updateData).eq("orderId", order.orderId),
        "Update progress"
    );
    if (result?.error) { order.progress = oldProgress; order.status = oldStatus; return; }
    if (order.status === "Completed" && oldStatus !== "Completed") {
      sendEmailNotification({ type: "status_changed", recipient: order.customerEmail, data: order });
    }
    renderOrders(getActiveFilter());
}

function updateSummary() {
    if (totalOrders) totalOrders.innerText = orders.length;
    if (pendingOrders) pendingOrders.innerText = orders.filter(o => o.status === 'Pending' || o.status === 'Pending Signing').length;
    if (approvedOrders) approvedOrders.innerText = orders.filter(o => o.status === 'Approved').length;
    if (completedOrders) completedOrders.innerText = orders.filter(o => o.status === 'Completed').length;
}

function getActiveFilter() {
    const active = document.querySelector('.filter-btn.active');
    return active ? active.innerText.trim() : 'All';
}

const filterButtons = document.querySelectorAll('.filter-btn');
filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
        filterButtons.forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        const filter = button.innerText.trim();
        renderOrders(filter);
    });
});

window.approveOrder = approveOrder;
window.approveCancellation = approveCancellation;
window.rejectCancellation = rejectCancellation;
window.approveCustom = approveCustom;
window.requestRevision = requestRevision;
window.approveSchedule = approveSchedule;
window.rejectSchedule = rejectSchedule;
window.viewOrder = viewOrder;
window.updateProgress = updateProgress;

(async function init() {
    const result = await handleDbError(
        supabase.from("boat_orders").select("*").order("createdAt", { ascending: false }),
        "Load orders"
    );
    orders = (result && !result.error ? result.data : []) || [];

    const orderUserIds = [...new Set(orders.map(o => o.userId).filter(Boolean))];
    if (orderUserIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, phone").in("id", orderUserIds);
        if (profiles) {
            profiles.forEach(p => { profilePhoneMap[p.id] = p; });
        }
    }

    renderOrders('All');

    const channel = supabase.channel("dashorder-realtime");
    channel.on("postgres_changes",
        { event: "INSERT", schema: "public", table: "boat_orders" },
        (payload) => {
            const o = payload.new;
            orders.unshift(o);
            const currentFilter = getActiveFilter();
            renderOrders(currentFilter);
            showToast(`New order: ${o.boatName || "Boat"} from ${o.customerName || "Unknown"}`, "info");
            notifySound();
        }
    );
    channel.on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "boat_orders" },
        (payload) => {
            const updated = payload.new;
            const idx = orders.findIndex(o => o.orderId === updated.orderId);
            if (idx !== -1) orders[idx] = updated;
            else orders.unshift(updated);
            const currentFilter = getActiveFilter();
            renderOrders(currentFilter);
        }
    );
    channel.on("postgres_changes",
        { event: "DELETE", schema: "public", table: "boat_orders" },
        (payload) => {
            const deletedId = payload.old.orderId;
            orders = orders.filter(o => o.orderId !== deletedId);
            const currentFilter = getActiveFilter();
            renderOrders(currentFilter);
        }
    );
    channel.subscribe();
})();
