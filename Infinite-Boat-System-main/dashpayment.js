import { supabase, handleDbError, sendEmailNotification, API_BASE } from "./supabase.js";
import { companyBanks } from "./bankConfig.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

// Session & role guard
(async () => {
  const session = await window.refreshValidSession();
  if (!session) { window.location.href = "login.html"; return; }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
  if (!profile || profile.role !== "admin") { window.location.href = "login.html"; return; }
})();

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
    const res = await fetch(API_BASE + "/workers/seed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      body: JSON.stringify({ workers: WORKER_REGISTRY.map(w => ({ name: w.name, specialty: w.specialty })) })
    });
    const result = await res.json();
    if (result.seeded) {
      console.log("[WORKERS] Seeded " + result.count + " workers");
    } else if (result.reason === "already seeded") {
      // already seeded, nothing to do
    } else {
      console.error("[WORKERS] Seed failed:", result.error || result);
    }
  } catch (err) {
    console.error("[WORKERS] Seed error:", err);
  }
}

let payments = [];

const paymentContainer = document.getElementById("paymentContainer");
const totalPayments = document.getElementById("totalPayments");
const approvedPayments = document.getElementById("approvedPayments");
const pendingPayments = document.getElementById("pendingPayments");


/* =========================================================
   HELPERS
========================================================= */

function getPaymentStatus(pay) {
    return pay.status || pay.paymentStatus || 'Pending';
}

function getProofImage(pay) {
    return pay.proofImage || pay.paymentProof || '';
}

function fmt(num) {
    return '₱' + Number(num).toLocaleString();
}

function parseAmount(str) {
    return parseFloat(String(str || '0').replace(/[₱,]/g, '')) || 0;
}

function normalizePayment(p) {
    if (!p) return p;
    p.amountPaid   = p.amountPaid ?? p.amount ?? 0;
    p.bankName     = p.bankName ?? p.bank ?? '';
    p.paymentPhase = p.paymentPhase ?? p.phase ?? '';
    p.referenceNumber = p.referenceNumber ?? p.reference ?? '';
    p.submittedDate = p.submittedDate ?? p.createdAt ?? '';
    p.accountName  = p.accountName ?? '';
    p.accountNumber = p.accountNumber ?? '';
    p.paymentMethod = p.paymentMethod ?? 'Bank Transfer';
    p.remainingBalance = p.remainingBalance ?? 0;
    p.boatImage    = p.boatImage ?? './images/boat2.jpg';
    const bankInfo = companyBanks[p.bankName];
    p.companyAccountName = bankInfo?.accountName || '';
    p.companyAccountNumber = bankInfo?.accountNumber || '';
    return p;
}

async function loadPayments() {
    const { data } = await handleDbError(
        supabase.from("dashboard_payments").select("*").order("createdAt", { ascending: false }),
        "Load payments"
    ) || {};
    payments = (data || []).map(normalizePayment);

    const orderIds = [...new Set(payments.map(p => p.orderId).filter(Boolean))];
    let orderMap = {};
    if (orderIds.length > 0) {
        const { data: orders } = await handleDbError(
            supabase.from("boat_orders").select("orderId, remainingBalance, boatPrice, paymentMethod").in("orderId", orderIds),
            "Load orders for remaining balance"
        ) || {};
        if (orders) orders.forEach(o => { orderMap[o.orderId] = o; });
    }

    payments.forEach(p => {
        const order = orderMap[p.orderId];
        if (order) {
            p.remainingBalance = Number(order.remainingBalance) || 0;
        }
    });

    let totalAmount = 0, approvedCount = 0, pendingCount = 0;

    const html = payments.map((payment, index) => {
        const status = getPaymentStatus(payment);
        const numericAmount = parseAmount(payment.amountPaid);
        totalAmount += numericAmount;
        if (status === "Approved") approvedCount++;
        else if (status === "Pending") pendingCount++;

        const fmtAmount = fmt(payment.amountPaid);
        const fmtRemaining = fmt(payment.remainingBalance);

        return `
        <div class="payment-card">
            <div class="payment-left">
                <div class="payment-header">
                    <div class="boat-info">
                        <img src="${payment.boatImage}" class="boat-image">
                        <div>
                            <h2>${payment.boatName || 'Boat'}</h2>
                            <p>Customer: ${payment.customerName || 'Unknown'}</p>
                        </div>
                    </div>
                    <span class="status ${status.toLowerCase()}">${status}</span>
                </div>
                <div class="bank-section">
                    <h3>Customer Account Information</h3>
                    <div class="bank-grid">
                        <div class="bank-box"><span>Bank Used</span><strong>${payment.bankName || 'N/A'}</strong></div>
                        <div class="bank-box"><span>Company Account Name</span><strong>${payment.companyAccountName || 'N/A'}</strong></div>
                        <div class="bank-box"><span>Company Account Number</span><strong>${payment.companyAccountNumber || 'N/A'}</strong></div>
                    </div>
                </div>
                <div class="details-grid">
                    <div class="detail-box"><h4>Payment Phase</h4><p>${payment.paymentPhase || 'N/A'}</p></div>
                    <div class="detail-box"><h4>Payment Method</h4><p>${payment.paymentMethod}</p></div>
                    <div class="detail-box"><h4>Amount Paid</h4><p>${fmtAmount}</p></div>
                    <div class="detail-box"><h4>Remaining Balance</h4><p>${fmtRemaining}</p></div>
                    <div class="detail-box"><h4>Reference Number</h4><p>${payment.referenceNumber || 'N/A'}</p></div>
                    <div class="detail-box"><h4>Submitted Date</h4><p>${payment.submittedDate ? new Date(payment.submittedDate).toLocaleString() : 'N/A'}</p></div>
                </div>
                <div class="button-group">
                    ${status === "Pending" ? `
                    <button class="approve-btn" data-index="${index}">Approve Payment</button>
                    ` : `
                    <button class="view-btn" data-index="${index}">View Details</button>
                    `}
                </div>
            </div>
            <div class="payment-right">
                <h3>Uploaded Proof</h3>
                <img src="${getProofImage(payment)}" class="proof-image">
                <div class="proof-footer">
                    <span>Uploaded Screenshot</span>
                    <i class="fa-solid fa-image"></i>
                </div>
            </div>
        </div>`;
    }).join('');

    paymentContainer.innerHTML = html || '<div style="padding:40px;text-align:center;color:#94a3b8;">No payments found.</div>';
    if (totalPayments) totalPayments.textContent = fmt(totalAmount);
    if (approvedPayments) approvedPayments.textContent = approvedCount;
    if (pendingPayments) pendingPayments.textContent = pendingCount;
}

async function approvePayment(index) {
    if (!confirm('Approve this payment?')) return;
    const payment = payments[index];
    const oldStatus = payment.status;
    payment.status = "Approved";
    payment.paymentStatus = "Approved";

    const result = await handleDbError(
        supabase.from("dashboard_payments").update({ status: "Approved" }).eq("id", payment.id),
        "Approve payment"
    );
    if (result?.error) {
        payment.status = oldStatus;
        payment.paymentStatus = oldStatus;
        return;
    }

    const ordersRes = await supabase.from("boat_orders").select("*").eq("orderId", payment.orderId);
    if (ordersRes.error || !ordersRes.data || ordersRes.data.length === 0) {
        loadPayments();
        return;
    }
    const order = ordersRes.data[0];
    const currentStep = order.paymentStep || 0;
    const nextStep = currentStep + 1;
    const cleanPriceVal = parseAmount(order.boatPrice);
    const isFullPayment = (order.paymentMethod || '').toLowerCase() === 'full payment';

    const phaseAmounts = isFullPayment
        ? [cleanPriceVal, 0, 0]
        : [cleanPriceVal * 0.30, cleanPriceVal * 0.40, cleanPriceVal * 0.30];
    let paidSoFar = phaseAmounts.slice(0, nextStep).reduce((a, b) => a + b, 0);

    const newPaymentStep = nextStep;
    const newRemaining = Math.max(0, cleanPriceVal - paidSoFar);
    const paymentHistory = order.paymentHistory || [];
    paymentHistory.push({
        phase: isFullPayment ? "Full Payment" : (payment.phase || ("Phase " + (currentStep + 1))),
        amount: parseAmount(payment.amount),
        date: new Date().toISOString(),
        status: "Approved",
        reference: payment.reference || "",
        bank: payment.bank || ""
    });

    const updateData = {
        paymentStep: newPaymentStep,
        remainingBalance: newRemaining,
        paymentHistory: paymentHistory
    };

    if (currentStep === 0 && nextStep === 1) {
        updateData.progress = 10;
        updateData.orderPhase = 'Boat Construction Started';
    }

    const updateResult = await handleDbError(
        supabase.from("boat_orders").update(updateData).eq("orderId", order.orderId),
        "Update order payment status"
    );
    if (updateResult?.error) {
        console.error("Order update failed but payment was approved");
    }

    sendEmailNotification({ type: "payment_approved", recipient: payment.customerEmail, data: payment });

    loadPayments();
    showToast('Payment approved successfully!', 'success');
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.approve-btn, .view-btn');
    if (!btn) return;
    const index = parseInt(btn.dataset.index);
    if (btn.classList.contains('approve-btn')) {
        approvePayment(index);
    } else if (btn.classList.contains('view-btn')) {
        const pay = payments[index];
        const modal = document.getElementById('paymentModal');
        const body = document.getElementById('paymentModalBody');
        body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><strong>Customer</strong><p>${pay.customerName || 'N/A'}</p></div>
            <div><strong>Boat</strong><p>${pay.boatName || 'N/A'}</p></div>
            <div><strong>Bank</strong><p>${pay.bankName || 'N/A'}</p></div>
            <div><strong>Amount Paid</strong><p>${fmt(pay.amountPaid)}</p></div>
            <div><strong>Reference</strong><p>${pay.referenceNumber || 'N/A'}</p></div>
            <div><strong>Date</strong><p>${pay.submittedDate ? new Date(pay.submittedDate).toLocaleString() : 'N/A'}</p></div>
            <div><strong>Status</strong><p><span class="status ${getPaymentStatus(pay).toLowerCase()}">${getPaymentStatus(pay)}</span></p></div>
        </div>`;
        modal.classList.add('show');
    }
});

const payChannel = supabase.channel("dashpayment-realtime");
payChannel.on("postgres_changes",
    { event: "INSERT", schema: "public", table: "dashboard_payments" },
    (payload) => {
        const p = payload.new;
        payments.unshift(p);
        loadPayments();
        showToast(`New payment: ${p.boatName || "Boat"} — ₱${Number(p.amount || 0).toLocaleString()}`, "success");
        notifySound();
    }
);
payChannel.on("postgres_changes",
    { event: "UPDATE", schema: "public", table: "dashboard_payments" },
    (payload) => {
        const updated = payload.new;
        const idx = payments.findIndex(p => p.id === updated.id);
        if (idx !== -1) payments[idx] = updated;
        else payments.unshift(updated);
        loadPayments();
    }
);
payChannel.subscribe();

ensureWorkerRegistry().then(() => loadPayments());
