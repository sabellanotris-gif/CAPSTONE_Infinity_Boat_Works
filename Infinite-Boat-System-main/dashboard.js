let supabase;

(async function init() {
    const mod = await import("./supabase.js");
    supabase = mod.supabase;

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

const adminNameSpan = document.querySelector('.topbar h1 span');
const storedUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
function applyAdminIdentity(user) {
  const displayName = (user && (user.name || user.email))
    ? (user.name || user.email.split('@')[0])
    : "Admin";
  if (adminNameSpan && displayName) {
    adminNameSpan.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);
  }
  const adminProfile = document.getElementById('adminprofile');
  if (user && user.photo) {
    adminProfile.src = user.photo;
  }
}
applyAdminIdentity(storedUser);
if (!storedUser.email && !storedUser.name) {
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, photo, email")
          .eq("id", session.user.id)
          .maybeSingle();
        applyAdminIdentity({
          name: profile?.name || session.user.email,
          email: profile?.email || session.user.email,
          photo: profile?.photo
        });
      }
    } catch (e) { console.error("Failed to load admin identity:", e); }
  })();
}

// Session & role guard
(async () => {
  // Ensure the supabase.js module (and its window.requireRole helper) is fully
  // loaded before the guard runs — the top-level init() below imports it lazily.
  if (typeof window.requireRole !== "function") {
    await import("./supabase.js");
  }
  const auth = await window.requireRole(["admin"]);
  if (auth?.profile) {
    // Keep the topbar tuned to the LIVE profile for this tab's session, not a
    // stale shared key. requireRole already cached the verified profile.
    applyAdminIdentity({
      name: auth.profile.name || auth.profile.email,
      email: auth.profile.email,
      photo: auth.profile.photo,
    });
    sessionStorage.setItem("currentUser", JSON.stringify({
      name: auth.profile.name || auth.profile.email,
      email: auth.profile.email,
      photo: auth.profile.photo || "./images/user.png",
    }));
  }
})();

/* =============================================
   HELPERS
   ============================================= */

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
    if (progress >= 100) return "Boat Completed";
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

function getPaymentStatusClass(s) {
    if (s === 'Approved') return 'approved';
    if (s === 'Rejected') return 'rejected';
    return 'pending';
}

function cleanPrice(val) {
    if (typeof val === 'number') return val || 0;
    return parseFloat(String(val || '0').replace(/[₱,$\s]/g, '')) || 0;
}

/* =============================================
   DATA
   ============================================= */

let allOrders = [];
let allPayments = [];
let profilePhoneMap = {};

async function loadAllData() {
    try {
        const ordersRes = await supabase.from("boat_orders").select("*").order("createdAt", { ascending: false });
        allOrders = ordersRes.data || [];
        try { localStorage.setItem("boatOrders", JSON.stringify(allOrders)); } catch (e) { /* quota full - ignore */ }
    } catch (e) {
        console.error("Failed to load orders:", e);
        allOrders = JSON.parse(localStorage.getItem("boatOrders") || "[]");
    }

    const orderUserIds = [...new Set(allOrders.map(o => o.userId).filter(Boolean))];
    if (orderUserIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, phone").in("id", orderUserIds);
        if (profiles) {
            profiles.forEach(p => { profilePhoneMap[p.id] = p; });
        }
    }

    try {
        const paymentsRes = await supabase.from("dashboard_payments").select("*").order("createdAt", { ascending: false });
        allPayments = paymentsRes.data || [];
    } catch (e) {
        console.error("Failed to load payments:", e);
        allPayments = JSON.parse(localStorage.getItem("dashboardPayments") || "[]");
    }

    let inventory = [];
    try {
        const inventoryRes = await supabase.from("inventory").select("*");
        inventory = inventoryRes.data || [];
    } catch (e) {
        console.error("Failed to load inventory:", e);
    }

    try { loadDashboardData(); } catch (e) { console.error("loadDashboardData:", e); }
    try { renderLiveProjects(); } catch (e) { console.error("renderLiveProjects:", e); }
    try { renderRecentPayments(); } catch (e) { console.error("renderRecentPayments:", e); }
    try { renderInventoryAlerts(inventory); } catch (e) { console.error("renderInventoryAlerts:", e); }
    try { renderDonutCharts(); } catch (e) { console.error("renderDonutCharts:", e); }
    try { renderUpcomingMilestones(); } catch (e) { console.error("renderUpcomingMilestones:", e); }
    try { renderOverdueTasks(); } catch (e) { console.error("renderOverdueTasks:", e); }
    try { renderProjectsByPhase(); } catch (e) { console.error("renderProjectsByPhase:", e); }
}

/* =============================================
   ANALYTICS CARDS
   ============================================= */

function loadDashboardData() {
    const activeOrders = allOrders.filter(o => o.status !== "Completed" && o.status !== "Cancelled" && o.status !== "Rejected").length;
    const completedOrders = allOrders.filter(o => o.status === 'Completed').length;
    const pendingPayments = allPayments.filter(p => p.status === 'Pending').length;
    const totalRevenue = allOrders.reduce((sum, o) => sum + cleanPrice(o.boatPrice || o.price), 0);

    const revenueEl = document.querySelector('.revenue-circle h2');
    const ordersEl = document.querySelector('.orders-circle h2');
    const pendingEl = document.querySelector('.pending-circle h2');
    const completedEl = document.querySelector('.completed-circle h2');

    if (revenueEl) revenueEl.textContent = '₱' + (totalRevenue / 1000000).toFixed(1) + 'M';
    if (ordersEl) ordersEl.textContent = activeOrders;
    if (pendingEl) pendingEl.textContent = pendingPayments;
    if (completedEl) completedEl.textContent = completedOrders;

    const revSub = document.querySelector('.revenue-circle + h3 + p');
    const ordSub = document.querySelector('.orders-circle + h3 + p');
    const penSub = document.querySelector('.pending-circle + h3 + p');
    const comSub = document.querySelector('.completed-circle + h3 + p');
    if (revSub) revSub.textContent = allOrders.length + ' total orders';
    if (ordSub) ordSub.textContent = activeOrders + ' ongoing builds';
    if (penSub) penSub.textContent = pendingPayments + ' awaiting verification';
    if (comSub) comSub.textContent = completedOrders + ' delivered successfully';

    const revenueCircle = document.querySelector('.revenue-circle');
    const ordersCircle = document.querySelector('.orders-circle');
    const pendingCircle = document.querySelector('.pending-circle');
    const completedCircle = document.querySelector('.completed-circle');

    const collectedAmt = allPayments.filter(p => p.status === 'Approved').reduce((s, p) => s + cleanPrice(p.amountPaid ?? p.amount ?? 0), 0);
    const revPct = totalRevenue > 0 ? Math.min(100, Math.round((collectedAmt / totalRevenue) * 100)) : 0;
    const ordPct = allOrders.length > 0 ? Math.min(100, Math.round((activeOrders / allOrders.length) * 100)) : 0;
    const penPct = allPayments.length > 0 ? Math.min(100, Math.round((pendingPayments / allPayments.length) * 100)) : 0;
    const comPct = allOrders.length > 0 ? Math.min(100, Math.round((completedOrders / allOrders.length) * 100)) : 0;

    if (revenueCircle) revenueCircle.style.background = 'conic-gradient(#295dff 0% ' + revPct + '%, #dbeafe ' + revPct + '% 100%)';
    if (ordersCircle) ordersCircle.style.background = 'conic-gradient(#2563eb 0% ' + ordPct + '%, #dbeafe ' + ordPct + '% 100%)';
    if (pendingCircle) pendingCircle.style.background = 'conic-gradient(#f59e0b 0% ' + penPct + '%, #fde68a ' + penPct + '% 100%)';
    if (completedCircle) completedCircle.style.background = 'conic-gradient(#22c55e 0% ' + comPct + '%, #dcfce7 ' + comPct + '% 100%)';
}

/* =============================================
   LIVE PROJECTS — Accordion Sections
   ============================================= */

function renderLiveProjects() {
    const container = document.getElementById('liveProjectsContainer');
    if (!container) return;

    const groups = [
        { label: "Under Review", statuses: ["Under Review"], icon: "fa-wand-magic-sparkles", color: "#7c3aed" },
        { label: "Pending Signing", statuses: ["Pending Signing"], icon: "fa-file-pen", color: "#2563eb" },
        { label: "In Progress", statuses: ["Approved"], icon: "fa-hard-hat", color: "#16a34a" },
        { label: "Completed", statuses: ["Completed"], icon: "fa-circle-check", color: "#22c55e" },
        { label: "Cancelled / Rejected", statuses: ["Cancelled", "Rejected"], icon: "fa-ban", color: "#dc2626" }
    ];

    let html = '';
    for (const g of groups) {
        const items = allOrders.filter(o => g.statuses.includes(o.status));
        if (items.length === 0) continue;
        html += `
        <div class="accordion-section">
            <div class="accordion-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div>
                    <i class="fa-solid ${g.icon}" style="color:${g.color}"></i>
                    <strong>${g.label}</strong>
                    <span class="section-count">${items.length}</span>
                </div>
                <i class="fa-solid fa-chevron-down accordion-arrow"></i>
            </div>
            <div class="accordion-body">
                ${items.map(o => renderProjectRow(o)).join('')}
            </div>
        </div>`;
    }
    container.innerHTML = html || '<div style="padding:30px;text-align:center;color:#94a3b8;">No orders found.</div>';
}

function renderProjectRow(o) {
    const progress = o.progress || 0;
    const stage = getBuildStage(progress, o.status, o);
    const statusClass = getStatusClass(o.status);
    return `
    <div class="project-row">
        <div class="project-info">
            <img src="${o.buildType === 'custom' && o.customConfig?.boatPreviewImage ? o.customConfig.boatPreviewImage : (o.boatImage || './images/boat1.jpg')}">
            <div>
                <h3>${o.boatName || 'Boat'}</h3>
                <p>Client: ${o.customerName || 'Unknown'} ${o.buildType === 'custom' ? '<span class="custom-badge">Custom</span>' : ''}</p>
            </div>
        </div>
        <div class="project-stage">${stage}</div>
        <div class="project-progress">
            <div class="progress-bar">
                <div class="progress-fill" style="width:${progress}%;"></div>
            </div>
            <span>${progress}%</span>
        </div>
        <span class="status ${statusClass}">${o.status}</span>
        <button class="info-btn" onclick="showOrderInfo('${o.orderId}')" title="See All Information"><i class="fa-solid fa-eye"></i></button>
    </div>`;
}

/* =============================================
   ORDER INFO MODAL
   ============================================= */

window.showOrderInfo = function (orderId) {
    const order = allOrders.find(o => o.orderId === orderId);
    if (!order) return alert('Order not found.');

    const schedule = window.parseContractSchedule(order) || {};
    const history = order.paymentHistory || [];
    const progress = order.progress || 0;
    const totalPrice = cleanPrice(order.boatPrice);
    const paid = totalPrice - cleanPrice(order.remainingBalance);
    const statusClass = getStatusClass(order.status);

    let historyHtml = '';
    if (history.length > 0) {
        historyHtml = history.map(h => `
            <div class="modal-history-item">
                <span class="phase">${h.phase}</span>
                <span class="amt">₱${Number(h.amount || 0).toLocaleString()}</span>
                <span class="dt">${h.date ? new Date(h.date).toLocaleDateString() : ''}</span>
                <span class="st ${(h.status || 'Pending').toLowerCase()}">${h.status || 'Pending'}</span>
            </div>
        `).join('');
    } else {
        historyHtml = '<div style="font-size:13px;color:#94a3b8;">No payment history yet.</div>';
    }

    document.getElementById('orderInfoBody').innerHTML = `
        <div class="modal-header">
            <img src="${order.boatImage || './images/boat1.jpg'}" alt="Boat">
            <div>
                <h2>${order.boatName || 'Boat'}</h2>
                <p>Order ID: ${order.orderId}</p>
                <span class="status ${statusClass}" style="display:inline-block;margin-top:6px;font-size:12px;padding:4px 12px;">${order.status}</span>
                ${order.buildType === 'custom' ? '<span class="custom-badge" style="font-size:12px;padding:3px 10px;">Custom Build</span>' : ''}
            </div>
        </div>
        <div class="modal-info-grid">
            <div class="field"><label>Customer Name</label><span>${order.customerName || 'N/A'}</span></div>
            <div class="field"><label>Email</label><span>${order.customerEmail || 'N/A'}</span></div>
            <div class="field"><label>Phone</label><span>${order.customerPhone || profilePhoneMap[order.userId]?.phone || 'N/A'}</span></div>
            <div class="field"><label>Build Type</label><span>${order.buildType === 'custom' ? 'Custom Build' : 'Standard Build'}</span></div>
            <div class="field"><label>Payment Method</label><span>${order.paymentMethod || 'N/A'}</span></div>
            <div class="field"><label>Boat Price</label><span>₱${totalPrice.toLocaleString()}</span></div>
            <div class="field"><label>Downpayment</label><span>${order.downpayment || 'N/A'}</span></div>
            <div class="field"><label>Remaining Balance</label><span>₱${cleanPrice(order.remainingBalance).toLocaleString()}</span></div>
            <div class="field"><label>Build Time</label><span>${order.buildTime || 'N/A'}</span></div>
            <div class="field"><label>Order Phase</label><span>${order.orderPhase || 'N/A'}</span></div>
            <div class="field"><label>Order Date</label><span>${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}</span></div>
            <div class="field"><label>Progress</label><span>${progress}%</span></div>
        </div>
        <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:4px;">
                <span>Amount Paid: ₱${paid.toLocaleString()}</span>
                <span>Remaining: ₱${Math.max(0, totalPrice - paid).toLocaleString()}</span>
            </div>
            <div class="progress-bar" style="height:14px;">
                <div class="progress-fill" style="width:${totalPrice > 0 ? Math.min(100, (paid / totalPrice) * 100) : 0}%;"></div>
            </div>
        </div>
        ${order.buildType === 'custom' && order.customConfig ? `
        <div class="modal-section-title" style="color:#6b21a8;"><i class="fa-solid fa-wand-magic-sparkles"></i> Custom Boat Design</div>
        ${order.customConfig.boatPreviewImage ? `
        <div style="text-align:center;margin-bottom:14px;">
            <img src="${order.customConfig.boatPreviewImage}" alt="Custom Boat Preview"
                 style="max-width:100%;max-height:280px;border-radius:12px;border:2px solid #d8b4fe;cursor:pointer;object-fit:contain;"
                 onclick="window.open('${order.customConfig.boatPreviewImage}', '_blank')" />
        </div>` : ''}
        <div class="modal-info-grid" style="margin-bottom:12px;">
            ${order.customConfig.length ? `<div class="field"><label>Length</label><span>${order.customConfig.length}m</span></div>` : ''}
            ${order.customConfig.width ? `<div class="field"><label>Width</label><span>${order.customConfig.width}m</span></div>` : ''}
            ${order.customConfig.seats ? `<div class="field"><label>Seats</label><span>${order.customConfig.seats}</span></div>` : ''}
            ${order.customConfig.engineName && order.customConfig.engineName !== 'None' ? `<div class="field"><label>Engine</label><span>${order.customConfig.engineName}</span></div>` : ''}
            ${order.customConfig.ledName && order.customConfig.ledName !== 'None' ? `<div class="field"><label>LED</label><span>${order.customConfig.ledName}</span></div>` : ''}
        </div>
        <div style="display:flex;gap:20px;margin-bottom:12px;flex-wrap:wrap;">
            ${order.customConfig.color ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${order.customConfig.color};border:2px solid #d1d5db;"></span><span><strong>Hull:</strong> ${order.customConfig.hullColorName || 'N/A'}</span></div>` : ''}
            ${order.customConfig.deckColor ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${order.customConfig.deckColor};border:2px solid #d1d5db;"></span><span><strong>Deck:</strong> ${order.customConfig.deckColorName || 'N/A'}</span></div>` : ''}
            ${order.customConfig.railColor ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${order.customConfig.railColor};border:2px solid #d1d5db;"></span><span><strong>Rail:</strong> ${order.customConfig.railColorName || 'N/A'}</span></div>` : ''}
        </div>
        ${order.customConfig.items && order.customConfig.items.length > 0 ? `
        <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:12px;margin-bottom:12px;">
            <div style="font-size:11px;font-weight:700;color:#6b21a8;text-transform:uppercase;margin-bottom:6px;">Price Breakdown</div>
            ${order.customConfig.items.map(i => `<div style="font-size:12px;color:#475569;display:flex;justify-content:space-between;padding:2px 0;"><span>${i.name}</span><span>₱${Number(i.amount || 0).toLocaleString()}</span></div>`).join('')}
            ${order.customConfig.totalPrice ? `<div style="font-size:13px;font-weight:800;color:#6b21a8;display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #e9d5ff;"><span>Total</span><span>${order.customConfig.totalPrice}</span></div>` : ''}
        </div>` : ''}
        ` : ''}
        ${schedule.date || schedule.time || schedule.location ? `
        <div class="modal-section-title"><i class="fa-solid fa-calendar-check"></i> Contract Signing Schedule</div>
        <div class="modal-info-grid">
            <div class="field"><label>Date</label><span>${window.formatScheduleDateTime(schedule.date, schedule.time)}</span></div>
            <div class="field"><label>Location</label><span>${schedule.location || 'N/A'}</span></div>
            <div class="field"><label>Signature</label><span>${schedule.signature || 'N/A'}</span></div>
        </div>` : ''}
        <div class="modal-section-title"><i class="fa-solid fa-clock-rotate-left"></i> Payment History</div>
        ${historyHtml}
    `;
    document.getElementById('orderInfoModal').style.display = 'flex';
};

window.closeOrderInfo = function () {
    document.getElementById('orderInfoModal').style.display = 'none';
};

/* =============================================
   RECENT PAYMENTS — Clickable
   ============================================= */

function renderRecentPayments() {
    const list = document.getElementById('recentPaymentsContainer');
    if (!list) return;

    const recent = allPayments.slice(0, 10);

    if (recent.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">No payments yet.</div>';
        return;
    }

    list.innerHTML = recent.map(p => {
        const order = allOrders.find(o => o.orderId === p.orderId);
        const boatName = order?.boatName || p.boatName || 'Boat';
        const buildType = order?.buildType || 'standard';
        const status = p.status || 'Pending';
        const sc = getPaymentStatusClass(status);
        return `
        <div class="payment-item clickable-payment" onclick="showPaymentInfo('${p.id}')">
            <div>
                <h4>${p.customerName || 'Unknown'}</h4>
                <p>${boatName} ${buildType === 'custom' ? '<span class="custom-badge">Custom</span>' : '<span class="custom-badge" style="background:#e0f2fe;color:#0284c7;">Standard</span>'}</p>
            </div>
            <div style="text-align:right;">
                <span>₱${Number(p.amount || p.amountPaid || 0).toLocaleString()}</span>
                <br>
                <span class="status ${sc}" style="display:inline-block;margin-top:4px;font-size:11px;padding:3px 10px;">${status}</span>
            </div>
        </div>`;
    }).join('');
}

/* =============================================
   PAYMENT INFO MODAL
   ============================================= */

window.showPaymentInfo = function (paymentId) {
    const payment = allPayments.find(p => String(p.id) === String(paymentId));
    if (!payment) return alert('Payment not found.');

    const order = allOrders.find(o => o.orderId === payment.orderId);
    const status = payment.status || 'Pending';
    const sc = getPaymentStatusClass(status);

    document.getElementById('paymentInfoBody').innerHTML = `
        <div class="modal-header">
            <img src="${order?.buildType === 'custom' && order?.customConfig?.boatPreviewImage ? order.customConfig.boatPreviewImage : (order?.boatImage || payment.boatImage || './images/boat1.jpg')}" alt="Boat">
            <div>
                <h2>${order?.boatName || payment.boatName || 'Boat'}</h2>
                <p>Payment by: ${payment.customerName || 'Unknown'}</p>
                <span class="status ${sc}" style="display:inline-block;margin-top:6px;font-size:12px;padding:4px 12px;">${status}</span>
                ${order?.buildType === 'custom' ? '<span class="custom-badge" style="font-size:12px;padding:3px 10px;">Custom Build</span>' : ''}
            </div>
        </div>
        <div class="modal-info-grid">
            <div class="field"><label>Customer Name</label><span>${payment.customerName || 'N/A'}</span></div>
            <div class="field"><label>Email</label><span>${payment.customerEmail || 'N/A'}</span></div>
            <div class="field"><label>Order ID</label><span>${payment.orderId || 'N/A'}</span></div>
            <div class="field"><label>Build Type</label><span>${order?.buildType === 'custom' ? 'Custom' : 'Standard'}</span></div>
            <div class="field"><label>Payment Method</label><span>${order?.paymentMethod || 'N/A'}</span></div>
            <div class="field"><label>Amount Paid</label><span>₱${Number(payment.amount || payment.amountPaid || 0).toLocaleString()}</span></div>
            <div class="field"><label>Phase</label><span>${payment.phase || payment.paymentPhase || 'N/A'}</span></div>
            <div class="field"><label>Bank / Wallet</label><span>${payment.bank || payment.bankName || 'N/A'}</span></div>
            <div class="field"><label>Account Name</label><span>${payment.accountName || 'N/A'}</span></div>
            <div class="field"><label>Account Number</label><span>${payment.accountNumber || 'N/A'}</span></div>
            <div class="field"><label>Reference Number</label><span>${payment.reference || payment.referenceNumber || 'N/A'}</span></div>
            <div class="field"><label>Submitted Date</label><span>${payment.submittedDate || payment.createdAt ? new Date(payment.submittedDate || payment.createdAt).toLocaleDateString() : 'N/A'}</span></div>
        </div>
    `;
    document.getElementById('paymentInfoModal').style.display = 'flex';
};

window.closePaymentInfo = function () {
    document.getElementById('paymentInfoModal').style.display = 'none';
};

/* =============================================
   INVENTORY ALERTS
   ============================================= */

function renderInventoryAlerts(items) {
    const container = document.getElementById('inventoryAlertsContainer');
    if (!container) return;

    const lowStock = items.filter(i => (i.stock || 0) <= 5);

    if (lowStock.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">All inventory stocked.</div>';
        return;
    }

    container.innerHTML = lowStock.map(i => {
        const stock = i.stock || 0;
        const msg = stock <= 0 ? 'Out of Stock' : (stock === 1 ? '1 Remaining' : 'Low Stock (' + stock + ')');
        return '<div class="alert-item"><i class="fa-solid fa-triangle-exclamation"></i>' + (i.name || 'Item') + ' - ' + msg + '</div>';
    }).join('');
}

/* =============================================
   DONUT CHARTS
   ============================================= */

function renderDonutCharts() {
    const container = document.getElementById('donutChartsContainer');
    if (!container) return;

    const totalRevenue = allOrders.reduce((s, o) => s + cleanPrice(o.boatPrice || o.price), 0);
    const collected = allPayments.filter(p => p.status === 'Approved').reduce((s, p) => s + cleanPrice(p.amountPaid ?? p.amount ?? 0), 0);
    const remaining = Math.max(0, totalRevenue - collected);
    const revPct = totalRevenue > 0 ? Math.round((collected / totalRevenue) * 100) : 0;

    const statusGroups = [
        { label: 'Completed', color: '#22c55e', count: allOrders.filter(o => o.status === 'Completed').length },
        { label: 'In Progress', color: '#295dff', count: allOrders.filter(o => o.status === 'Approved').length },
        { label: 'Pending Signing', color: '#f59e0b', count: allOrders.filter(o => o.status === 'Pending Signing').length },
        { label: 'Under Review', color: '#7c3aed', count: allOrders.filter(o => o.status === 'Under Review').length },
        { label: 'Cancelled', color: '#ef4444', count: allOrders.filter(o => o.status === 'Cancelled' || o.status === 'Rejected').length }
    ];
    const totalOrders = allOrders.length;
    const statusSegments = [];
    let cumPct = 0;
    for (const g of statusGroups) {
        const pct = totalOrders > 0 ? (g.count / totalOrders) * 100 : 0;
        statusSegments.push({ ...g, pct, start: cumPct, end: cumPct + pct });
        cumPct += pct;
    }
    const statusBg = statusSegments.filter(s => s.count > 0).map(s =>
        `${s.color} ${s.start}% ${s.end}%`
    ).join(', ');

    container.innerHTML = `
        <div class="donut-container">
            <div class="donut-card">
                <h4>Revenue Progress</h4>
                <div class="donut" style="background:conic-gradient(#22c55e 0% ${revPct}%, #e2e8f0 ${revPct}% 100%);">
                    <div class="donut-label">${revPct}%<small>collected</small></div>
                </div>
                <div class="donut-legend">
                    <div class="legend-item"><span class="legend-dot" style="background:#22c55e;"></span> Collected <span>₱${(collected / 1000000).toFixed(1)}M</span></div>
                    <div class="legend-item"><span class="legend-dot" style="background:#e2e8f0;"></span> Remaining <span>₱${(remaining / 1000000).toFixed(1)}M</span></div>
                    <div class="legend-item" style="border-top:1px solid #e2e8f0;padding-top:4px;margin-top:4px;"><strong>Total Contract</strong> <span>₱${(totalRevenue / 1000000).toFixed(1)}M</span></div>
                </div>
            </div>
            <div class="donut-card">
                <h4>Order Status</h4>
                <div class="donut" style="background:conic-gradient(${statusBg || '#e2e8f0 0% 100%'});">
                    <div class="donut-label">${totalOrders}<small>total orders</small></div>
                </div>
                <div class="donut-legend">
                    ${statusGroups.filter(s => s.count > 0).map(s => `
                        <div class="legend-item"><span class="legend-dot" style="background:${s.color};"></span> ${s.label} <span>${s.count}</span></div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

/* =============================================
   SEARCH
   ============================================= */

const searchInput = document.querySelector('.search-box input');
searchInput?.addEventListener('input', function () {
    const query = this.value.toLowerCase();
    document.querySelectorAll('.accordion-section').forEach(section => {
        let hasMatch = false;
        section.querySelectorAll('.project-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            const match = text.includes(query);
            row.style.display = match ? '' : 'none';
            if (match) hasMatch = true;
        });
        section.style.display = hasMatch ? '' : 'none';
    });
});

/* =============================================
   QUICK ACTION BUTTONS
   ============================================= */

document.querySelector('.quick-actions button:first-child')?.addEventListener('click', () => window.location.href = 'dashorder.html');
document.querySelector('.quick-actions button:nth-child(2)')?.addEventListener('click', () => window.location.href = 'dashinventory.html');
document.querySelector('.quick-actions button:nth-child(3)')?.addEventListener('click', () => window.location.href = 'dashpayment.html');

document.querySelector('.card-header button')?.addEventListener('click', () => window.location.href = 'dashorder.html');

/* =============================================
   ADMIN NOTIFICATION SYSTEM
   ============================================= */

function safeName(val) {
    return (val && val !== "undefined" && val.trim()) ? val.trim() : "Unknown";
}

function safeBoat(val) {
    return (val && val !== "undefined" && val.trim()) ? val.trim() : "A Boat";
}

function generateAdminNotifications() {
    const notes = [];
    const chk = JSON.parse(localStorage.getItem("adminNotifCheckpoint") || "{}");
    const orders = allOrders.length > 0 ? allOrders : JSON.parse(localStorage.getItem("boatOrders") || "[]");

    orders.forEach(o => {
        const id = o.orderId || o.boatName + (o.createdAt || "");
        const prev = chk[id];

        function makeNote(label) {
            return { msg: `${safeBoat(o.boatName)}: ${label}`, time: new Date().toISOString(), link: "dashorder.html" };
        }

        if (!prev) {
            chk[id] = { status: o.status, progress: o.progress };
            if (o.status === "Pending Signing") {
                notes.push({ msg: `New order: ${safeBoat(o.boatName)} from ${safeName(o.customerName)}`, time: new Date().toISOString(), link: "dashorder.html" });
            } else if (o.status === "Under Review") {
                notes.push({ msg: `Custom design submitted by ${safeName(o.customerName)}`, time: new Date().toISOString(), link: "dashorder.html" });
            }
            return;
        }

        if (prev.status !== o.status) {
            if (o.status === "Cancellation Requested") {
                notes.push({ msg: `Cancellation requested by ${safeName(o.customerName)} for ${safeBoat(o.boatName)}`, time: new Date().toISOString(), link: "dashorder.html" });
            } else if (o.status === "Cancelled") {
                notes.push(makeNote("Cancellation approved"));
            } else if (o.status === "Approved" && (prev.status === "Pending Signing" || prev.status === "Pending" || prev.status === "Under Review")) {
                notes.push(makeNote("Order approved"));
            } else if (o.status === "Rejected") {
                notes.push(makeNote("Order rejected"));
            } else if (o.status === "Revision Required") {
                notes.push(makeNote("Revision requested"));
            } else if (o.status === "Completed") {
                notes.push(makeNote("Order completed!"));
            } else if (o.status === "Pending Signing" && prev.status === "Under Review") {
                notes.push(makeNote("Custom design finalized, awaiting contract"));
            } else {
                notes.push(makeNote(`Status changed to "${o.status}"`));
            }
            chk[id] = { status: o.status, progress: o.progress };
        } else if (prev.progress !== o.progress) {
            notes.push(makeNote(`Progress updated to ${o.progress}%`));
            chk[id] = { status: o.status, progress: o.progress };
        }
    });

    const payments = allPayments.length > 0 ? allPayments : JSON.parse(localStorage.getItem("dashboardPayments") || "[]");
    const payChk = JSON.parse(localStorage.getItem("adminPayNotifCheckpoint") || "{}");
    payments.forEach(p => {
        const id = p.id || p.orderId || p.boatName + (p.date || "");
        const prev = payChk[id];
        if (!prev) {
            payChk[id] = p.status;
            if (p.status === "Pending") {
                notes.push({ msg: `Payment pending: ${safeBoat(p.boatName)} — ₱${Number(p.amount || p.amountPaid || 0).toLocaleString()}`, time: new Date().toISOString(), link: "dashpayment.html" });
            }
            return;
        }
        if (prev !== p.status) {
            const label = p.status === "Approved" ? "Payment approved" : p.status === "Rejected" ? "Payment rejected" : `Payment ${p.status}`;
            notes.push({ msg: `${safeBoat(p.boatName)}: ${label}`, time: new Date().toISOString(), link: "dashpayment.html" });
            payChk[id] = p.status;
        }
    });
    localStorage.setItem("adminPayNotifCheckpoint", JSON.stringify(payChk));

    localStorage.setItem("adminNotifCheckpoint", JSON.stringify(chk));

    const existing = JSON.parse(localStorage.getItem("adminNotifications") || "[]");
    const merged = [...notes, ...existing].slice(0, 20);
    localStorage.setItem("adminNotifications", JSON.stringify(merged));
    return merged;
}

function renderAdminNotifications(notes) {
    const badge = document.getElementById("adminNotifBadge");
    const list = document.getElementById("adminNotifList");
    if (!badge || !list) return;

    const lastViewed = parseInt(localStorage.getItem("adminNotifLastViewed") || "0");
    const unreadCount = notes.filter(n => new Date(n.time).getTime() > lastViewed).length;

    if (notes.length === 0) {
        badge.style.display = "none";
        list.innerHTML = '<div class="notif-empty">No notifications</div>';
        return;
    }

    if (unreadCount > 0) {
        badge.style.display = "inline";
        badge.textContent = unreadCount;
    } else {
        badge.style.display = "none";
    }

    list.innerHTML = notes.map(n => `
        <div class="notif-item" data-link="${n.link || ""}">
            <div class="notif-dot"></div>
            <div class="notif-content">
                <p>${n.msg}</p>
                <span>${new Date(n.time).toLocaleDateString()}</span>
            </div>
        </div>
    `).join("");

    list.querySelectorAll(".notif-item").forEach(item => {
        item.addEventListener("click", () => {
            document.getElementById("adminNotifDropdown")?.classList.remove("show");
            const link = item.dataset.link;
            if (link) window.location.href = link;
        });
    });
}

const adminNotes = generateAdminNotifications();
renderAdminNotifications(adminNotes);

const adminBell = document.getElementById("adminNotifBell");
const adminDropdown = document.getElementById("adminNotifDropdown");
if (adminBell && adminDropdown) {
    adminBell.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.setItem("adminNotifLastViewed", Date.now());
        const badge = document.getElementById("adminNotifBadge");
        if (badge) badge.style.display = "none";
        adminDropdown.classList.toggle("show");
    });
    document.addEventListener("click", (e) => {
        if (!adminBell.contains(e.target) && !adminDropdown.contains(e.target)) {
            adminDropdown.classList.remove("show");
        }
    });
}

document.getElementById("adminMarkAllRead")?.addEventListener("click", () => {
    localStorage.removeItem("adminNotifications");
    renderAdminNotifications([]);
    const badge = document.getElementById("adminNotifBadge");
    if (badge) { badge.style.display = "none"; badge.textContent = "0"; }
    document.getElementById("adminNotifDropdown")?.classList.remove("show");
});

/* =============================================
   PROJECT ALERTS
   ============================================= */

function renderUpcomingMilestones() {
    const container = document.getElementById('upcomingMilestonesContainer');
    if (!container) return;

    const activeOrders = allOrders.filter(o => o.status === "Approved" && (o.progress || 0) < 100);
    const upcoming = [];

    activeOrders.forEach(o => {
        const ms = o.milestones || [];
        ms.forEach(m => {
            if (!m.completed) {
                upcoming.push({
                    boatName: o.boatName || "Boat",
                    customerName: o.customerName || "Unknown",
                    milestone: m.label,
                    percentage: m.percentage,
                    progress: o.progress || 0
                });
            }
        });
    });

    upcoming.sort((a, b) => a.percentage - b.percentage);
    const top3 = upcoming.slice(0, 3);

    if (top3.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">No upcoming milestones.</div>';
        return;
    }

    container.innerHTML = top3.map(m => `
        <div class="alert-item">
            <i class="fa-solid fa-flag" style="color:#295dff;"></i>
            <div>
                <strong style="font-size:13px;">${m.milestone}</strong>
                <p style="font-size:11px;color:#64748b;">${m.boatName} — ${m.customerName} (${m.progress}% → ${m.percentage}%)</p>
            </div>
        </div>
    `).join('');
}

async function renderOverdueTasks() {
    const container = document.getElementById('overdueTasksContainer');
    if (!container) return;

    let tasks = [];
    try {
        const { data } = await supabase.from("project_tasks").select("*");
        tasks = data || [];
    } catch (e) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">Could not load tasks.</div>';
        return;
    }

    const now = new Date();
    const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "Done");

    if (overdue.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">No overdue tasks. <i class="fa-solid fa-check-circle" style="color:#22c55e;"></i></div>';
        return;
    }

    container.innerHTML = overdue.slice(0, 5).map(t => {
        const order = allOrders.find(o => o.orderId === t.orderId);
        const boatName = order?.boatName || "Boat";
        return `
        <div class="alert-item">
            <i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i>
            <div>
                <strong style="font-size:13px;color:#dc2626;">${t.title}</strong>
                <p style="font-size:11px;color:#64748b;">${boatName} — Due: ${new Date(t.dueDate).toLocaleDateString()} ${t.assignedTo ? '— ' + t.assignedTo : ''}</p>
            </div>
        </div>`;
    }).join('');

    if (overdue.length > 5) {
        container.innerHTML += `<div style="padding:10px;text-align:center;font-size:12px;color:#64748b;">+${overdue.length - 5} more overdue tasks</div>`;
    }
}

function renderProjectsByPhase() {
    const container = document.getElementById('projectsByPhaseContainer');
    if (!container) return;

    const phaseGroups = {};
    const activeOrders = allOrders.filter(o => o.status === "Approved" || o.status === "Pending" || o.status === "Under Review" || o.status === "Pending Signing");

    activeOrders.forEach(o => {
        const phase = o.orderPhase || "Unknown";
        phaseGroups[phase] = (phaseGroups[phase] || 0) + 1;
    });

    const entries = Object.entries(phaseGroups).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">No active projects.</div>';
        return;
    }

    const total = activeOrders.length;
    container.innerHTML = entries.map(([phase, count]) => {
        const pct = Math.round((count / total) * 100);
        return `
        <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span style="font-weight:600;color:#0f172a;">${phase}</span>
                <span style="color:#64748b;">${count} (${pct}%)</span>
            </div>
            <div class="progress-bar" style="height:8px;">
                <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,#4f7cff,#295dff);"></div>
            </div>
        </div>`;
    }).join('');
}

/* =============================================
   INIT
   ============================================= */

loadAllData();

/* =============================================
   REALTIME SUBSCRIPTIONS
   ============================================= */

function setupAdminRealtime() {
    const channel = supabase.channel("admin-realtime");

    channel.on("postgres_changes",
        { event: "INSERT", schema: "public", table: "boat_orders" },
        (payload) => {
            const o = payload.new;
            showToast(`New order: ${o.boatName || "Boat"} from ${o.customerName || "Unknown"}`, "info");
            notifySound();
            loadAllData();
        }
    );

    channel.on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "boat_orders" },
        () => { loadAllData(); }
    );

    channel.on("postgres_changes",
        { event: "INSERT", schema: "public", table: "dashboard_payments" },
        (payload) => {
            const p = payload.new;
            showToast(`New payment: ${p.boatName || "Boat"} — ₱${Number(p.amount || 0).toLocaleString()}`, "success");
            notifySound();
            loadAllData();
        }
    );

    channel.on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "dashboard_payments" },
        () => { loadAllData(); }
    );

    channel.on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "inventory" },
        () => { loadAllData(); }
    );

    channel.subscribe();
}

setupAdminRealtime();

})();
