import { supabase, sendEmailNotification, API_BASE } from "./supabase.js";
import { companyBanks } from "./bankConfig.js";

let workersCache = [];

function updateCompanyBankInfo(bankName) {
    const info = companyBanks[bankName];
    const container = document.getElementById('companyBankInfo');
    const nameEl = document.getElementById('companyBankName');
    const acctNameEl = document.getElementById('companyAccountName');
    const acctNumEl = document.getElementById('companyAccountNumber');

    if (info && container && nameEl && acctNameEl && acctNumEl) {
        container.style.display = 'block';
        nameEl.textContent = bankName;
        acctNameEl.textContent = info.accountName;
        acctNumEl.textContent = info.accountNumber;
    }
}


/* =====================================================
    LOAD PAYMENT ORDER
===================================================== */

let savedOrder =
JSON.parse(

    localStorage.getItem(
    'currentOrder'
    )

) ||

JSON.parse(

    localStorage.getItem(
    'clientBoatStatus'
    )

);

/* =====================================================
    VERIFY & REFRESH ORDER FROM DATABASE
===================================================== */

(async () => {
  if (!savedOrder || !savedOrder.orderId) {
    alert("No order selected. Redirecting to home page.");
    window.location.href = "home.html";
    return;
  }

  const { data: dbOrder } = await supabase
    .from("boat_orders")
    .select("*")
    .eq("orderId", savedOrder.orderId)
    .single();

  if (!dbOrder) {
    alert("Your order could not be found. It may have been removed or is no longer available. Redirecting to home page.");
    localStorage.removeItem("currentOrder");
    window.location.href = "home.html";
    return;
  }

  // Use fresh DB data and keep localStorage in sync
  savedOrder = dbOrder;
  localStorage.setItem("currentOrder", JSON.stringify(dbOrder));

  // Re-render the payment summary with fresh order data
  renderPaymentSummary(dbOrder);
})();

/* =====================================================
    CANCEL FEE MODE
===================================================== */

const _cancelFeeMode = new URLSearchParams(window.location.search).get("mode") === "cancelFee";

/* =====================================================
    ELEMENTS
===================================================== */

/* SUMMARY */

const paymentBoatImage =
document.getElementById(
'paymentBoatImage'
);

const paymentBoatName =
document.getElementById(
'paymentBoatName'
);

const paymentBoatPrice =
document.getElementById(
'paymentBoatPrice'
);

const paymentMethodType =
document.getElementById(
'paymentMethodType'
);

const paymentCurrentPhase =
document.getElementById(
'paymentCurrentPhase'
);

const paymentCurrentAmount =
document.getElementById(
'paymentCurrentAmount'
);

const paymentCurrentAmountText =
document.getElementById(
'paymentCurrentAmountText'
);

const paymentRemainingBalance =
document.getElementById(
'paymentRemainingBalance'
);

/* FORM */

const accountNameInput =
document.getElementById(
'accountName'
);

const accountNumberInput =
document.getElementById(
'accountNumber'
);

const referenceInput =
document.getElementById(
'referenceNumber'
);

const paymentProofInput =
document.getElementById(
'paymentProof'
);

const proofPreview =
document.getElementById(
'proofPreview'
);

/* BUTTON */

const payNowBtn =
document.getElementById(
'payNowBtn'
);

/* BANKS */

const bankCards =
document.querySelectorAll(
'.bank-card'
);

/* PHASES */

const phaseBoxes =
document.querySelectorAll(
'.phase-box'
);



/* =====================================================
   DEFAULT BANK
===================================================== */

let selectedBank =
'BDO Bank';

/* =====================================================
   RENDER PAYMENT SUMMARY
===================================================== */

function renderPaymentSummary(order) {
    if (!order) return;
    if (paymentBoatImage) paymentBoatImage.src = order.boatImage;
    if (paymentBoatName) paymentBoatName.innerText = order.boatName;
    if (paymentBoatPrice) paymentBoatPrice.innerText = order.boatPrice;
    if (paymentMethodType) paymentMethodType.innerText = order.paymentMethod;
    updatePaymentSummary(order);
}

renderPaymentSummary(savedOrder);

/* =====================================================
   LOAD & RENDER WORKERS
===================================================== */

async function loadWorkersForOrder(orderId) {
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

function renderWorkersChips(workers, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!workers || workers.length === 0) {
        const section = container.closest('.summary-workers, .preview-section, .receipt-section');
        if (section) section.style.display = 'none';
        return;
    }
    const section = container.closest('.summary-workers, .preview-section, .receipt-section');
    if (section) section.style.display = 'block';
    container.innerHTML = workers.map(w =>
        '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#e2e8f0;border-radius:20px;font-size:12px;font-weight:500;color:#1e293b;">' +
        '<i class="fa-solid fa-user" style="font-size:10px;color:#64748b;"></i> ' +
        w.name +
        ' <span style="font-size:10px;color:#64748b;">— ' + w.role + '</span>' +
        '</span>'
    ).join('');
}

async function autoAssignWorkers(orderId) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(API_BASE + "/workers/auto-assign/" + orderId, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: "Bearer " + token } : {})
            }
        });
        const result = await res.json();
        if (result.assigned) {
            workersCache = await loadWorkersForOrder(orderId);
            renderWorkersChips(workersCache, "workersList");
        }
    } catch (e) {
        console.error("Auto-assign workers error:", e);
    }
}

(async () => {
    workersCache = await loadWorkersForOrder(savedOrder.orderId);
    renderWorkersChips(workersCache, "workersList");
})();

/* =====================================================
   UPDATE PAYMENT SUMMARY
===================================================== */

function updatePaymentSummary(order){

    if (_cancelFeeMode) {
        const cancelFee = Number(order.cancelFee) || 0;
        const p = (amount) => `₱${amount.toLocaleString()}`;
        paymentCurrentPhase.innerText = 'Cancellation Fee';
        paymentCurrentAmount.value = p(cancelFee);
        paymentCurrentAmountText.innerText = p(cancelFee);
        paymentRemainingBalance.innerText = '₱0';
        phaseBoxes.forEach(b => { b.style.display = 'none'; });
        document.querySelector('.payment-summary')?.classList.add('cancel-fee-mode');
        document.querySelector('.preview-header h2').textContent = 'CANCELLATION FEE PAYMENT';
        document.querySelector('.preview-header p').textContent = 'Please review the cancellation fee details before payment';
        return;
    }

    const step =
    order.paymentStep || 0;

    const cleanPrice =
    Number(

        String(order.boatPrice)
        .replace(/[₱,]/g,'')
    );

    const isFullPayment = order.paymentMethod === "Full Payment";

    let phase1, phase2, phase3, phaseLabels;

    if (isFullPayment) {
        phase1 = cleanPrice;
        phase2 = 0;
        phase3 = 0;
    } else {
        phase1 = cleanPrice * 0.30;
        phase2 = cleanPrice * 0.40;
        phase3 = cleanPrice * 0.30;
    }

    const peso =
    (amount)=>{

        return `₱${amount.toLocaleString()}`;
    };

    /* =============================================
       RENDER PHASE BOXES
    ============================================== */

    const phaseContainer = document.getElementById('phaseContainer');
    if (phaseContainer) {
        if (isFullPayment) {
            phaseContainer.innerHTML = `
                <div class="phase-box">
                    <h3>100% Full Payment</h3>
                    <p>One-time full payment for the boat.</p>
                </div>
            `;
        } else {
            phaseContainer.innerHTML = `
                <div class="phase-box">
                    <h3>30% Downpayment</h3>
                    <p>Boat reservation and initial construction.</p>
                </div>
                <div class="phase-box">
                    <h3>40% Mid Construction</h3>
                    <p>Main structure and assembly process.</p>
                </div>
                <div class="phase-box">
                    <h3>30% Full Billing</h3>
                    <p>Final payment before delivery.</p>
                </div>
            `;
        }
    }

    /* =============================================
       PHASE 1
    ============================================== */

    if(step === 0){

        const phaseLabel = isFullPayment ? 'Full Payment' : 'Phase 1 - 30% Downpayment';

        paymentCurrentPhase.innerText = phaseLabel;

        paymentCurrentAmount.value =
        peso(phase1);

        paymentCurrentAmountText.innerText =
        peso(phase1);

        paymentRemainingBalance.innerText =
        isFullPayment ? '₱0' : peso(cleanPrice - phase1);

        activatePhase(0);
    }

    /* =============================================
       PHASE 2 (installment only)
    ============================================== */

    else if(step === 1 && !isFullPayment){

        paymentCurrentPhase.innerText =
        'Phase 2 - 40% Mid Construction';

        paymentCurrentAmount.value =
        peso(phase2);

        paymentCurrentAmountText.innerText =
        peso(phase2);

        paymentRemainingBalance.innerText =
        peso(
        cleanPrice -
        phase1 -
        phase2
        );

        activatePhase(1);
    }

    /* =============================================
       PHASE 3 (installment only)
    ============================================== */

    else if(step === 2 && !isFullPayment){

        paymentCurrentPhase.innerText =
        'Phase 3 - 30% Full Billing';

        paymentCurrentAmount.value =
        peso(phase3);

        paymentCurrentAmountText.innerText =
        peso(phase3);

        paymentRemainingBalance.innerText =
        '₱0';

        activatePhase(2);
    }

    /* =============================================
       FULLY PAID
    ============================================== */

    else{

        paymentCurrentPhase.innerText =
        'Fully Paid';

        paymentCurrentAmount.value =
        '₱0';

        paymentCurrentAmountText.innerText =
        '₱0';

        paymentRemainingBalance.innerText =
        '₱0';

        activatePhase(isFullPayment ? 0 : 3);

        if(payNowBtn){

            payNowBtn.disabled =
            true;

            payNowBtn.innerHTML =
            `
            <i class="fa-solid fa-circle-check"></i>
            Fully Paid
            `;
        }
    }
}

/* =====================================================
   ACTIVATE PHASE
===================================================== */

function activatePhase(step){

    const boxes =
    document.querySelectorAll(
    '.phase-box'
    );

    boxes.forEach(

        (box)=>{

            box.classList.remove(
            'active-phase'
            );
        }
    );

    if(step < boxes.length){

        boxes[step].classList.add(
        'active-phase'
        );
    }
}

/* =====================================================
   SELECT BANK
===================================================== */

bankCards.forEach(

    (card)=>{

        card.addEventListener(

            'click',

            ()=>{

                bankCards.forEach(

                    (removeCard)=>{

                        removeCard.classList.remove(
                        'active-bank'
                        );
                    }
                );

                card.classList.add(
                'active-bank'
                );

                selectedBank =
                card.dataset.bank ||
                'BDO Bank';

                updateCompanyBankInfo(
                selectedBank
                );
            }
        );
    }
);

updateCompanyBankInfo('BDO Bank');

/* =====================================================
   IMAGE PREVIEW
===================================================== */

if(paymentProofInput){

    paymentProofInput.addEventListener(

        'change',

        ()=>{

            const file =
            paymentProofInput.files[0];

            if(file){

                const reader =
                new FileReader();

                reader.onload =
                function(e){

                    proofPreview.src =
                    e.target.result;

                    proofPreview.style.display =
                    'block';
                };

                reader.readAsDataURL(
                file
                );
            }
        }
    );
}

/* =====================================================
   PAY NOW — STEP 1: VALIDATE + SHOW PREVIEW
===================================================== */

let pendingPaymentProofImage = null;
let pendingReferenceNumber = '';

if(payNowBtn){

payNowBtn.addEventListener(
    'click',

    async ()=>{

        clearErrors();

        /* =========================================
           INPUT VALUES
        ========================================== */

        const accountName =
        accountNameInput.value
        .trim();

        const accountNumber =
        accountNumberInput.value
        .trim();

        pendingReferenceNumber =
        referenceInput.value
        .trim();

        /* =========================================
           VALIDATION
        ========================================== */

        if(!accountName){

            markError(
            accountNameInput,
            'Please enter account name.'
            );

            return;
        }

        if(!accountNumber){

            markError(
            accountNumberInput,
            'Please enter account number.'
            );

            return;
        }

        if(!pendingReferenceNumber){

            markError(
            referenceInput,
            'Please enter reference number.'
            );

            return;
        }

        if(
            !paymentProofInput.files.length
        ){

            alert(
            'Please upload payment proof.'
            );

            return;
        }

            /* =========================================
               VERIFY ORDER STATUS
            ========================================== */

            const { data: latest } = await supabase
              .from("boat_orders")
              .select("status")
              .eq("orderId", savedOrder.orderId)
              .single();

            if (!latest) {
              alert("Order not found. The order may have been removed or is no longer available.");
              return;
            }

            if (!_cancelFeeMode && latest.status !== "Approved") {
              alert("Payment is not available yet. Please wait for the admin to approve your contract signing schedule.");
              return;
            }

            /* =========================================
               READ IMAGE
            ========================================== */

            const file =
            paymentProofInput.files[0];

            pendingPaymentProofImage = await new Promise(resolve => {
              const r = new FileReader();
              r.onload = e => resolve(e.target.result);
              r.readAsDataURL(file);
            });

            /* =========================================
               POPULATE PREVIEW
            ========================================== */

            if (_cancelFeeMode) {
                document.getElementById("previewBoatImage").src = savedOrder.boatImage || "./images/boat2.jpg";
                document.getElementById("previewBoatName").textContent = savedOrder.boatName || "N/A";
                document.getElementById("previewPrice").textContent = "Cancellation Fee: ₱" + (Number(savedOrder.cancelFee) || 0).toLocaleString();
                document.getElementById("previewPaymentMethod").textContent = "Cancellation";
                document.getElementById("previewAccountName").textContent = "Account Name: " + accountName;
                document.getElementById("previewAccountNumber").textContent = "Account Number: " + accountNumber;
                document.getElementById("previewReferenceNumber").textContent = "Reference: " + pendingReferenceNumber;
                document.getElementById("previewBank").textContent = "Bank: " + selectedBank;
                document.getElementById("previewAmount").textContent = "Amount: ₱" + parseFloat(String(paymentCurrentAmount.value).replace(/[₱,]/g, "") || 0).toLocaleString();
                document.getElementById("previewPhase").textContent = "Phase: Cancellation Fee";
                // Hide irrelevant sections
                document.getElementById("previewDownpayment").parentElement.style.display = "none";
                document.getElementById("previewBuildTime").style.display = "none";
                document.getElementById("previewBuildTime2").parentElement.style.display = "none";
                document.querySelector('.preview-section h4')?.closest('.preview-section')?.querySelectorAll('p[id^="previewSchedule"]')?.forEach(p => p.closest('.preview-section').style.display = "none");
                const scheduleSection = document.getElementById("previewScheduleDate")?.closest('.preview-section');
                if (scheduleSection) scheduleSection.style.display = "none";
                const workersSection = document.getElementById("previewWorkersSection");
                if (workersSection) workersSection.style.display = "none";
                const customSection = document.getElementById("previewCustomSection");
                if (customSection) customSection.style.display = "none";
            } else {
                const schedule = window.parseContractSchedule(savedOrder) || {};
                document.getElementById("previewBoatImage").src = savedOrder.boatImage || "./images/boat2.jpg";
                document.getElementById("previewBoatName").textContent = savedOrder.boatName || "N/A";
                document.getElementById("previewBuildTime").textContent = "Build Time: " + (savedOrder.buildTime || "N/A");
                document.getElementById("previewPrice").textContent = "₱" + (savedOrder.boatPrice ? Number(String(savedOrder.boatPrice).replace(/[₱,]/g,"")).toLocaleString() : "0");
                document.getElementById("previewDownpayment").textContent = savedOrder.downpayment || "N/A";
                document.getElementById("previewPaymentMethod").textContent = savedOrder.paymentMethod || "Full Payment";
                document.getElementById("previewBuildTime2").textContent = savedOrder.buildTime || "N/A";
                document.getElementById("previewScheduleDate").textContent = window.formatScheduleDateTime(schedule.date, schedule.time);
                document.getElementById("previewScheduleLocation").textContent = "Location: " + (schedule.location || "N/A");
                document.getElementById("previewAccountName").textContent = "Account Name: " + accountName;
                document.getElementById("previewAccountNumber").textContent = "Account Number: " + accountNumber;
                document.getElementById("previewReferenceNumber").textContent = "Reference: " + pendingReferenceNumber;
                document.getElementById("previewBank").textContent = "Bank: " + selectedBank;
                document.getElementById("previewAmount").textContent = "Amount: ₱" + parseFloat(String(paymentCurrentAmount.value).replace(/[₱,]/g, "") || 0).toLocaleString();
                document.getElementById("previewPhase").textContent = "Phase: " + (paymentCurrentPhase.innerText || "N/A");
            }

            /* =========================================
               POPULATE CUSTOM CONFIG (PREVIEW)
            ========================================== */

            if (savedOrder.buildType === "custom" && savedOrder.customConfig) {
                const cfg = savedOrder.customConfig;
                document.getElementById("previewCustomSection").style.display = "block";
                document.getElementById("previewBoatLength").textContent = cfg.length + "m";
                document.getElementById("previewBoatWidth").textContent = cfg.width + "m";
                if (cfg.items) {
                    let html = '';
                    cfg.items.forEach(i => {
                        html += '<div><span>' + i.name + '</span><strong>₱' + Number(i.amount).toLocaleString() + '</strong></div>';
                    });
                    document.getElementById("previewCustomItems").innerHTML = html;
                    const itemsContainer = document.getElementById("previewCustomItems");
                    itemsContainer.style.display = "grid";
                    itemsContainer.style.gridTemplateColumns = "1fr 1fr";
                    itemsContainer.style.gap = "8px";
                    document.getElementById("previewCustomLegacy").style.display = "none";
                } else {
                    document.getElementById("previewCustomLegacy").style.display = "block";
                    document.getElementById("previewEngine").textContent = "₱" + (cfg.engine ? Number(String(cfg.engine).replace(/[₱,]/g,"")).toLocaleString() : "0");
                    document.getElementById("previewSeats").textContent = cfg.seats || "N/A";
                    document.getElementById("previewLed").textContent = "₱" + (cfg.led ? Number(String(cfg.led).replace(/[₱,]/g,"")).toLocaleString() : "0");
                    document.getElementById("previewCustomItems").style.display = "none";
                }
                document.getElementById("previewHullColor").textContent = cfg.hullColorName || cfg.color || "N/A";
                document.getElementById("previewDeckColor").textContent = cfg.deckColorName || "N/A";
                document.getElementById("previewRailColor").textContent = cfg.railColorName || "N/A";
                document.getElementById("previewCustomTotal").textContent = cfg.totalPrice || "N/A";
            }

            renderWorkersChips(workersCache, "previewWorkersList");

            document.getElementById("previewOverlay").style.display = "flex";
        }
    );
}

/* =====================================================
   STEP 2: CONFIRM PREVIEW → SHOW CANCELLATION WARNING
===================================================== */

document.getElementById("confirmPreviewBtn")?.addEventListener("click", () => {
    document.getElementById("previewOverlay").style.display = "none";
    document.getElementById("warningOverlay").style.display = "flex";
});

document.getElementById("backFromPreviewBtn")?.addEventListener("click", () => {
    document.getElementById("previewOverlay").style.display = "none";
});

/* =====================================================
   FIELD ERROR HELPERS
===================================================== */

function markError(input, message) {
    input.classList.add('input-error');
    input.focus();
    alert(message);
}

function clearErrors() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
}

document.querySelectorAll('#accountName, #accountNumber, #referenceNumber').forEach(el => {
    el.addEventListener('input', () => el.classList.remove('input-error'));
    el.addEventListener('focus', () => el.classList.remove('input-error'));
});

/* =====================================================
   STEP 3: PROCEED → SUBMIT PAYMENT → SHOW RECEIPT
===================================================== */

document.getElementById("proceedPaymentBtn")?.addEventListener("click", async () => {
    document.getElementById("warningOverlay").style.display = "none";

    const amount = parseFloat(String(paymentCurrentAmount.value).replace(/[₱,]/g, "")) || 0;

    const cleanPrice = Number(String(savedOrder.boatPrice).replace(/[₱,]/g, "")) || 0;
    const isFullPay = (savedOrder.paymentMethod || '').toLowerCase() === 'full payment';
    const step = savedOrder.paymentStep || 0;
    let calcRemaining = 0;
    if (!isFullPay && !_cancelFeeMode) {
        if (step === 0) calcRemaining = cleanPrice * 0.70;
        else if (step === 1) calcRemaining = cleanPrice * 0.30;
        else calcRemaining = 0;
    }

    if (!isFullPay && !_cancelFeeMode) {
      const milestones = savedOrder.milestones;
      const progress = savedOrder.progress || 0;

      if (step === 1) {
        const targetMs = milestones ? [...milestones].reverse().find(m => m.percentage <= 40) : null;
        const blocked = targetMs ? !targetMs.completed : progress < 40;
        if (blocked) {
          alert("Mid-Construction payment is not yet available. Wait for construction to reach Phase 1 completion (40%).");
          return;
        }
      }
      if (step === 2) {
        const targetMs = milestones ? [...milestones].reverse().find(m => m.percentage <= 75) : null;
        const blocked = targetMs ? !targetMs.completed : progress < 75;
        if (blocked) {
          alert("Full payment is not yet available. Wait for construction to reach Phase 2 completion (75%).");
          return;
        }
      }
    }

    const { data: { session: paySession } } = await supabase.auth.getSession();
    const currentUserId = paySession?.user?.id || null;

    const { error: payError } = await supabase
      .from("dashboard_payments")
      .insert({
        orderId: savedOrder.orderId,
        customerName: savedOrder.customerName || localStorage.getItem("customerName") || "Customer",
        customerEmail: savedOrder.customerEmail || localStorage.getItem("customerEmail") || "",
        boatName: savedOrder.boatName,
        amount: amount,
        phase: paymentCurrentPhase.innerText,
        paymentStep: savedOrder.paymentStep || 0,
        bank: selectedBank,
        reference: pendingReferenceNumber,
        proofImage: pendingPaymentProofImage,
        accountName: accountNameInput.value.trim(),
        accountNumber: accountNumberInput.value.trim(),
        status: _cancelFeeMode ? "Approved" : "Pending",
        remainingBalance: calcRemaining,
        userId: currentUserId,
      });

    if (payError) {
      alert("Payment submission failed: " + payError.message);
      return;
    }

    autoAssignWorkers(savedOrder.orderId);

    const emailRecipient = savedOrder.customerEmail || localStorage.getItem("customerEmail") || "";
    sendEmailNotification({
      type: "payment_submitted",
      recipient: "infinityboatsystem@gmail.com",
      data: {
        orderId: savedOrder.orderId,
        customerName: savedOrder.customerName || localStorage.getItem("customerName"),
        boatName: savedOrder.boatName,
        amount: amount,
        bank: selectedBank,
        reference: pendingReferenceNumber,
        phase: paymentCurrentPhase.innerText
      }
    });
    if (_cancelFeeMode) {
      sendEmailNotification({
        type: "status_changed",
        recipient: emailRecipient,
        data: { orderId: savedOrder.orderId, customerName: savedOrder.customerName, customerEmail: emailRecipient, boatName: savedOrder.boatName, status: "Cancelled", orderPhase: "Cancelled (Fee Paid)", progress: 0 }
      });
    }

    /* =====================================
        CANCEL FEE MODE — AUTO-CANCEL ORDER
    ====================================== */

    if (_cancelFeeMode) {
      const cancelNow = new Date().toISOString();
      const { error: cancelError } = await supabase
        .from("boat_orders")
        .update({
          status: "Cancelled",
          orderPhase: "Cancelled",
          progress: 0,
          cancelPaidAt: cancelNow,
          cancelApprovedAt: cancelNow
        })
        .eq("orderId", savedOrder.orderId);
      if (cancelError) console.error("Failed to finalize cancellation:", cancelError);
      localStorage.removeItem("cancelPaymentMode");
    }

    /* =====================================
        SHOW RECEIPT
    ====================================== */

    const now = new Date();
    document.getElementById("receiptDate").textContent = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById("receiptBoatName").textContent = savedOrder.boatName || "N/A";

    if (_cancelFeeMode) {
        // Cancel fee receipt — minimal, distinct from boat payment receipt
        document.querySelector('.receipt-header h2').textContent = 'CANCELLATION FEE RECEIPT';
        document.getElementById("receiptCustomerName").textContent = savedOrder.customerName || localStorage.getItem("customerName") || "N/A";
        document.getElementById("receiptCustomerEmail").textContent = savedOrder.customerEmail || localStorage.getItem("customerEmail") || "N/A";
        document.getElementById("receiptOrderId").textContent = savedOrder.orderId || "N/A";
        document.getElementById("receiptAmount").textContent = "₱" + amount.toLocaleString();
        document.getElementById("receiptPhase").textContent = "Cancellation Fee";
        document.getElementById("receiptReference").textContent = "Reference: " + pendingReferenceNumber;
        document.getElementById("receiptBank").textContent = "Bank: " + selectedBank;
        // Hide irrelevant sections
        const receiptCustomSection = document.getElementById("receiptCustomSection");
        if (receiptCustomSection) receiptCustomSection.style.display = "none";
        const receiptWorkersSection = document.getElementById("receiptWorkersSection");
        if (receiptWorkersSection) receiptWorkersSection.style.display = "none";
        const receiptScheduleSection = document.getElementById("receiptScheduleSection");
        if (receiptScheduleSection) receiptScheduleSection.style.display = "none";
        // Replace cancellation policy warning with confirmation
        const warningEl = document.querySelector('.receipt-warning');
        if (warningEl) {
            warningEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> <strong>Cancellation Confirmed:</strong> Your order has been cancelled and the cancellation fee has been paid. Thank you for informing us.';
        }
    } else {

    // Reset receipt elements for normal payments
    document.querySelector('.receipt-header h2').textContent = 'PAYMENT RECEIPT';
    const warningElNormal = document.querySelector('.receipt-warning');
    if (warningElNormal) {
        warningElNormal.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>Cancellation Policy:</strong> Cancelling this order after payment may incur penalties, including administrative fees and charges for materials already allocated.';
    }

    /* =========================================
       POPULATE CUSTOM CONFIG (RECEIPT)
    ========================================== */

    if (savedOrder.buildType === "custom" && savedOrder.customConfig) {
        const cfg = savedOrder.customConfig;
        document.getElementById("receiptCustomSection").style.display = "block";
        let receiptHtml = '<div><strong>Length:</strong> ' + cfg.length + 'm</div>';
        receiptHtml += '<div><strong>Width:</strong> ' + cfg.width + 'm</div>';
        if (cfg.items) {
            cfg.items.forEach(i => {
                receiptHtml += '<div><strong>' + i.name + ':</strong> ₱' + Number(i.amount).toLocaleString() + '</div>';
            });
        } else {
            receiptHtml += '<div><strong>Engine:</strong> ₱' + (cfg.engine ? Number(String(cfg.engine).replace(/[₱,]/g,"")).toLocaleString() : "0") + '</div>';
            receiptHtml += '<div><strong>Seats:</strong> ' + (cfg.seats || "N/A") + '</div>';
            receiptHtml += '<div><strong>LED:</strong> ₱' + (cfg.led ? Number(String(cfg.led).replace(/[₱,]/g,"")).toLocaleString() : "0") + '</div>';
        }
        receiptHtml += '<div><strong>Hull Color:</strong> ' + (cfg.hullColorName || cfg.color || "N/A") + '</div>';
        receiptHtml += '<div><strong>Deck Color:</strong> ' + (cfg.deckColorName || "N/A") + '</div>';
        receiptHtml += '<div><strong>Rail Color:</strong> ' + (cfg.railColorName || "N/A") + '</div>';
        receiptHtml += '<div><strong>Custom Total:</strong> ' + (cfg.totalPrice || "N/A") + '</div>';
        document.getElementById("receiptCustomConfig").innerHTML = receiptHtml;
    }

    document.getElementById("receiptCustomerName").textContent = savedOrder.customerName || localStorage.getItem("customerName") || "N/A";
    document.getElementById("receiptCustomerEmail").textContent = savedOrder.customerEmail || localStorage.getItem("customerEmail") || "N/A";
    document.getElementById("receiptOrderId").textContent = savedOrder.orderId || "N/A";
    document.getElementById("receiptAmount").textContent = "₱" + amount.toLocaleString();
    document.getElementById("receiptPhase").textContent = paymentCurrentPhase.innerText || "N/A";
    document.getElementById("receiptReference").textContent = "Reference: " + pendingReferenceNumber;
    document.getElementById("receiptBank").textContent = "Bank: " + selectedBank;

    const schedule = window.parseContractSchedule(savedOrder);
    if (schedule && (schedule.date || schedule.time || schedule.location)) {
        document.getElementById("receiptScheduleSection").style.display = "block";
        document.getElementById("receiptScheduleDateTime").textContent = window.formatScheduleDateTime(schedule.date, schedule.time);
        document.getElementById("receiptScheduleLocation").textContent = "Location: " + (schedule.location || "N/A");
        document.getElementById("receiptScheduleSignature").textContent = "Signed by: " + (schedule.signature || "N/A");
    }

    renderWorkersChips(workersCache, "receiptWorkersList");

    } // end else (_cancelFeeMode)

    document.getElementById("receiptOverlay").style.display = "flex";

    /* =====================================
        RESET FORM
    ====================================== */

    referenceInput.value =
    '';

    paymentProofInput.value =
    '';

    proofPreview.style.display =
    'none';

    const successMsg = _cancelFeeMode
        ? 'Your cancellation fee has been paid. Your order has been cancelled.'
        : 'Your payment has been submitted successfully! Awaiting admin approval.';

    localStorage.setItem(
        'paymentSuccess',
        successMsg
    );
});

document.getElementById("backFromWarningBtn")?.addEventListener("click", () => {
    document.getElementById("warningOverlay").style.display = "none";
    document.getElementById("previewOverlay").style.display = "flex";
});

window.closeReceipt = function () {
    document.getElementById("receiptOverlay").style.display = "none";
    localStorage.removeItem("currentOrder");
    localStorage.removeItem("cancelPaymentMode");
    localStorage.removeItem("clientBoatStatus");
    window.location.href = "home.html";
};