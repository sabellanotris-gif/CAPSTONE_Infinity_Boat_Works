import { supabase, sendEmailNotification, getCustomerIdentity } from "./supabase.js";

// Ensure the logged-in customer's identity (never a stale admin/worker name)
(async () => {
  try {
    const identity = await getCustomerIdentity();
    if (identity.name) sessionStorage.setItem("customerName", identity.name);
    if (identity.email) sessionStorage.setItem("customerEmail", identity.email);
    if (identity.phone) sessionStorage.setItem("customerPhone", identity.phone);
    if (identity.photo) sessionStorage.setItem("customerImage", identity.photo);
  } catch (e) { /* non-fatal */ }
})();

const standardAcks = [
    "I confirm that I have read and understood the boat specifications, materials, and features.",
    "I acknowledge the pricing, downpayment requirement, and full payment terms.",
    "I understand the estimated production and delivery timeline.",
    "I have read and agree to the warranty terms and conditions.",
    "I understand that modifications after order placement may incur additional costs and delays.",
    "I understand the cancellation policy, including potential fees for cancellations after contract approval and possible delays in delivery."
];

const customAcks = [
    "I understand that all custom modifications are subject to engineering review and approval.",
    "I acknowledge that customizations may result in additional costs beyond the base price.",
    "I understand that production timelines may vary depending on the complexity of changes.",
    "I agree that the final design must pass structural, safety, and manufacturability review.",
    "I have read and agree to the customization policies, including warranty limitations.",
    "I understand the cancellation policy, including potential fees for cancellations after contract approval and possible delays in delivery."
];



let buildType = null;
let currentStep = 1;
let ackResponses = {};
let boatData = null;

// Calendar state
let calDate = new Date();
let selectedDateStr = null;

let rescheduleOrderId = null;
let isReschedule = false;

function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const isFinalize = urlParams.get("mode") === "finalize";
    const isResched = urlParams.get("mode") === "reschedule";

    document.getElementById("backFromInfo").addEventListener("click", () => goToStep(1));
    document.getElementById("proceedFromInfo").addEventListener("click", proceedFromInfo);
    if (isFinalize || isResched) {
        document.getElementById("backFromGuide").addEventListener("click", () => window.location.href = "home.html");
    } else {
        document.getElementById("backFromGuide").addEventListener("click", () => goToStep(2));
    }
    document.getElementById("proceedFromGuide").addEventListener("click", proceedFromGuide);
    if (isResched) {
        document.getElementById("backFromSign").addEventListener("click", () => window.location.href = "home.html");
    } else {
        document.getElementById("backFromSign").addEventListener("click", () => goToStep(3));
    }
    document.getElementById("submitOrder").addEventListener("click", submitOrder);
    document.getElementById("selectStandard").addEventListener("click", () => selectBuild("standard"));
    document.getElementById("selectCustom").addEventListener("click", () => selectBuild("custom"));

    initCalendar();
    populateTimeOptions();

    if (isResched) {
        const encoded = urlParams.get("order");
        if (!encoded) { window.location.href = "home.html"; return; }
        try {
            rescheduleOrderId = atob(encoded);
        } catch (e) { window.location.href = "home.html"; return; }
        isReschedule = true;
        loadRescheduleOrder(rescheduleOrderId);
        return;
    }

    if (isFinalize) {
        const finalizingOrder = JSON.parse(localStorage.getItem("finalizingCustomOrder"));
        if (!finalizingOrder) {
            window.location.href = "home.html";
            return;
        }
        boatData = {
            name: finalizingOrder.boatName.replace(" (Custom)", ""),
            price: finalizingOrder.boatPrice,
            buildTime: finalizingOrder.buildTime,
            downpayment: "Set After Approval",
            image: finalizingOrder.boatImage
        };
        buildType = "custom";
        document.getElementById("orderBoatImage").src = boatData.image;
        document.getElementById("orderBoatName").textContent = boatData.name;
        document.getElementById("orderBoatPrice").textContent = boatData.price;
        document.getElementById("orderBuildTime").innerHTML = boatData.buildTime || "N/A";
        document.getElementById("orderDownPayment").textContent = boatData.downpayment;

        document.querySelector(".build-options").style.display = "none";
        document.querySelector(".panel-desc").style.display = "none";

        showApprovedDesignSummary(finalizingOrder);
        return;
    }

    boatData = JSON.parse(localStorage.getItem("selectedBoat"));
    if (!boatData) {
        window.location.href = "home.html";
        return;
    }

    document.getElementById("orderBoatImage").src = boatData.image;
    document.getElementById("orderBoatName").textContent = boatData.name;
    document.getElementById("orderBoatPrice").textContent = boatData.price;
    document.getElementById("orderBuildTime").innerHTML = boatData.buildTime || "N/A";
    document.getElementById("orderDownPayment").textContent = boatData.downpayment || "N/A";

    const phoneInput = document.getElementById("customerPhoneInput");
    if (phoneInput) phoneInput.value = sessionStorage.getItem("customerPhone") || "";
}

function showApprovedDesignSummary(order) {
    goToStep(3);
    document.getElementById("flowTitle").textContent = "Approved Design - Finalize Order";

    boatData = {
        name: order.boatName.replace(" (Custom)", ""),
        price: order.boatPrice,
        buildTime: order.buildTime,
        downpayment: "Set After Approval",
        image: order.boatImage
    };

    const header = document.getElementById("guidelineHeader");
    header.innerHTML = `
        <div class="approved-summary" style="margin-bottom:24px;">
            <h3><i class="fa-solid fa-circle-check"></i> Design Approved</h3>
            <div class="summary-row"><span>Boat Model</span><strong>${order.boatName}</strong></div>
            <div class="summary-row"><span>Final Price</span><strong>${order.boatPrice}</strong></div>
            <div class="summary-row"><span>Build Time</span><strong>${order.buildTime}</strong></div>
            ${order.customConfig ? `
            <div class="summary-row"><span>Length</span><strong>${order.customConfig.length}m</strong></div>
            <div class="summary-row"><span>Width</span><strong>${order.customConfig.width}m</strong></div>
            ${order.customConfig.items ? order.customConfig.items.map(i => `
            <div class="summary-row"><span>${i.name}</span><strong>&#8369;${Number(i.amount).toLocaleString()}</strong></div>
            `).join('') : `
            <div class="summary-row"><span>Engine</span><strong>&#8369;${Number(order.customConfig.engine).toLocaleString()}</strong></div>
            <div class="summary-row"><span>Seats</span><strong>${order.customConfig.seats}</strong></div>
            <div class="summary-row"><span>LED</span><strong>&#8369;${Number(order.customConfig.led).toLocaleString()}</strong></div>
            `}
            <div class="summary-row"><span>Hull Color</span><strong>${order.customConfig.color}</strong></div>
            ` : ""}
            ${order.reviewFeedback ? `
            <div class="engineer-remarks">
                <h4><i class="fa-solid fa-file-pen"></i> Engineer Remarks</h4>
                <p>${order.reviewFeedback}</p>
            </div>` : ""}
        </div>
        <h3 id="guidelineTitle">Final Acknowledgment</h3>
        <p id="guidelineDesc">Please confirm that you have reviewed the approved design and accept all terms. Answer 'Yes' to all to proceed.</p>
    `;

    renderAcks(customAcks);
    document.getElementById("guidelineError").style.display = "none";
}

function selectBuild(type) {
    buildType = type;
    const infoContainer = document.getElementById("infoContent");

    if (type === "standard") {
        infoContainer.innerHTML = getStandardInfoHTML();
    } else {
        infoContainer.innerHTML = getCustomInfoHTML();
    }

    goToStep(2);
}

function proceedFromInfo() {
    const title = document.getElementById("guidelineTitle");
    const desc = document.getElementById("guidelineDesc");

    if (buildType === "standard") {
        title.textContent = "Pre-Order Acknowledgment";
        desc.textContent = "Please confirm you have read and understood the boat information. Answer 'Yes' to all to proceed.";
        renderAcks(standardAcks);
    } else {
        title.textContent = "Customization Acknowledgment";
        desc.textContent = "Please confirm you understand the customization process and policies. Answer 'Yes' to all to proceed.";
        renderAcks(customAcks);
    }

    goToStep(3);
}

function renderAcks(questions) {
    const container = document.getElementById("guidelineQuestions");
    container.innerHTML = "";
    ackResponses = {};

    questions.forEach((q, i) => {
        const div = document.createElement("div");
        div.className = "guideline-item";
        div.innerHTML = `
            <div class="g-question">${i + 1}. ${q}</div>
            <div class="g-options">
                <label><input type="radio" name="a_${i}" value="yes"> Yes</label>
                <label><input type="radio" name="a_${i}" value="no"> No</label>
            </div>
            <textarea class="g-comment" placeholder="Optional: Add a comment or explanation..." rows="2"></textarea>
        `;
        container.appendChild(div);
        div.querySelectorAll('input[name="a_' + i + '"]').forEach(r => {
            r.addEventListener("change", () => {
                ackResponses[i] = r.value;
                document.getElementById("guidelineError").style.display = "none";
            });
        });
    });
}

function proceedFromGuide() {
    const questions = document.querySelectorAll("#guidelineQuestions .guideline-item");
    let allYes = true;
    let allAnswered = true;
    let firstNo = -1;

    questions.forEach((q, i) => {
        const sel = q.querySelector('input[name="a_' + i + '"]:checked');
        if (!sel) { allAnswered = false; }
        else if (sel.value === "no") { allYes = false; if (firstNo === -1) firstNo = i; }
    });

    if (!allAnswered) {
        showAckError("Please answer all acknowledgment questions.");
        return;
    }
    if (!allYes) {
        showAckError("You must acknowledge all items to proceed. Please review question #" + (firstNo + 1) + ".");
        return;
    }

    document.getElementById("guidelineError").style.display = "none";

    const isFinalize = new URLSearchParams(window.location.search).get("mode") === "finalize";
    if (isFinalize) {
        const finalizingOrder = JSON.parse(localStorage.getItem("finalizingCustomOrder"));
        if (finalizingOrder) {
            document.getElementById("finalBoatName").textContent = finalizingOrder.boatName;
            document.getElementById("finalBuildType").textContent = "Approved Custom Build";
            document.getElementById("finalPrice").textContent = finalizingOrder.boatPrice;
            document.getElementById("finalBuildTime").textContent = finalizingOrder.buildTime;
            document.getElementById("finalDownpayment").textContent = "Set After Approval";
        }
        goToStep(4);
        return;
    }

    if (buildType === "standard") {
        populateFinalSummary();
        goToStep(4);
    } else {
        saveCustomBuildDraft();
        populateCustomFinalSummary();
        goToStep(4);
    }
}

function showAckError(msg) {
    document.getElementById("errorMessage").textContent = msg;
    document.getElementById("guidelineError").style.display = "flex";
}

function populateFinalSummary() {
    document.getElementById("finalBoatName").textContent = boatData.name;
    document.getElementById("finalBuildType").textContent = "Standard Build";
    document.getElementById("finalPrice").textContent = boatData.price;
    document.getElementById("finalBuildTime").textContent = boatData.buildTime || "N/A";
    document.getElementById("finalDownpayment").textContent = boatData.downpayment || "N/A";
}

function populateCustomFinalSummary() {
    document.getElementById("finalBoatName").textContent = boatData.name + " (Custom)";
    document.getElementById("finalBuildType").textContent = "Custom Build";
    document.getElementById("finalPrice").textContent = boatData.price;
    document.getElementById("finalBuildTime").textContent = boatData.buildTime || "N/A";
    document.getElementById("finalDownpayment").textContent = boatData.downpayment || "N/A";
}

function goToStep(step) {
    currentStep = step;
    document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
    document.getElementById("panel" + step).classList.add("active");

    document.querySelectorAll(".step").forEach((s, i) => {
        const num = i + 1;
        s.classList.remove("active", "completed");
        if (num === step) s.classList.add("active");
        else if (num < step) s.classList.add("completed");
    });

    document.querySelectorAll(".step-line").forEach((line, i) => {
        line.classList.toggle("active", i + 1 < step);
    });

    document.querySelectorAll(".step-labels span").forEach((s, i) => {
        s.classList.toggle("active", i + 1 === step);
    });

    const titles = {
        1: "Choose Your Build Type",
        2: buildType === "standard" ? "Boat Information" : "Customization Information",
        3: buildType === "standard" ? "Pre-Order Acknowledgment" : "Customization Acknowledgment",
        4: "Schedule Contract Signing"
    };
    document.getElementById("flowTitle").textContent = titles[step] || "";
}

function getScheduleData() {
    const date = document.getElementById("signingDate").value;
    const time = document.getElementById("signingTime").value;
    const location = document.getElementById("signingLocation").value.trim();
    const notes = document.getElementById("signingNotes").value.trim();
    const signature = document.getElementById("signingSignature").value.trim();
    return { date, time, location, notes, signature };
}

function validateSchedule(data) {
    clearOrderErrors();
    if (!data.date) { markOrderError(document.getElementById("signingDate"), "Please select your preferred date for contract signing."); return false; }
    if (!data.time) { markOrderError(document.getElementById("signingTime"), "Please select your preferred time for contract signing."); return false; }
    if (!data.location) { markOrderError(document.getElementById("signingLocation"), "Please enter the meeting location."); return false; }
    if (data.location.length < 3) { markOrderError(document.getElementById("signingLocation"), "Please enter a valid meeting location (at least 3 characters)."); return false; }
    if (!data.signature) { markOrderError(document.getElementById("signingSignature"), "Please type your full name as your digital signature."); return false; }
    if (data.signature.length < 2) { markOrderError(document.getElementById("signingSignature"), "Please type your full name as signature (at least 2 characters)."); return false; }
    const registeredName = sessionStorage.getItem("customerName");
    if (registeredName && data.signature !== registeredName) {
        markOrderError(document.getElementById("signingSignature"), 'Signature must match your registered name: "' + registeredName + '".');
        return false;
    }
    const selected = new Date(data.date + "T" + data.time);
    if (selected <= new Date()) { alert("Please select a future date and time."); return false; }
    const day = selected.getDay();
    if (day === 0) { alert("We are closed on Sundays. Please select a weekday (Monday to Saturday)."); return false; }
    const hours = selected.getHours();
    const mins = selected.getMinutes();
    if (hours < 8 || hours >= 17 || (hours === 17 && mins > 0)) {
        alert("Please select a time between 8:00 AM and 5:00 PM (Mon–Fri)."); return false;
    }
    return true;
}

// ── Field error helpers ──
function markOrderError(input, message) {
    input.classList.add('input-error');
    input.focus();
    alert(message);
}

function clearOrderErrors() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
}

document.querySelectorAll('#signingLocation, #signingSignature, #signingTime').forEach(el => {
    el.addEventListener('input', () => el.classList.remove('input-error'));
    el.addEventListener('focus', () => el.classList.remove('input-error'));
    el.addEventListener('change', () => el.classList.remove('input-error'));
});

// ── Calendar Widget ──
function initCalendar() {
    renderCalendar();
    document.getElementById("calPrev").addEventListener("click", () => { calDate.setMonth(calDate.getMonth() - 1); renderCalendar(); });
    document.getElementById("calNext").addEventListener("click", () => { calDate.setMonth(calDate.getMonth() + 1); renderCalendar(); });
}

function renderCalendar() {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    document.getElementById("calMonthYear").textContent = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tbody = document.getElementById("calBody");
    tbody.innerHTML = "";
    let row = document.createElement("tr");
    for (let i = 0; i < firstDay; i++) {
        row.appendChild(document.createElement("td"));
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement("td");
        const dateObj = new Date(year, month, d);
        const dayOfWeek = dateObj.getDay();
        const dateStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        const isPast = dateObj < today;
        const isSun = dayOfWeek === 0;
        const disabled = isPast || isSun;

        cell.textContent = d;
        cell.style.cssText = "padding:8px;text-align:center;font-size:14px;cursor:" + (disabled ? "not-allowed" : "pointer") + ";border-radius:8px;";
        if (disabled) {
            cell.style.color = "#cbd5e1";
            cell.style.background = "#f8fafc";
        } else {
            cell.style.color = "#1e3a5f";
            cell.style.fontWeight = selectedDateStr === dateStr ? "700" : "400";
            cell.style.background = selectedDateStr === dateStr ? "#dbeafe" : "transparent";
            cell.addEventListener("click", () => selectDate(dateStr));
            cell.addEventListener("mouseenter", () => { if (selectedDateStr !== dateStr) cell.style.background = "#f1f5f9"; });
            cell.addEventListener("mouseleave", () => { if (selectedDateStr !== dateStr) cell.style.background = "transparent"; });
        }
        row.appendChild(cell);
        if ((firstDay + d) % 7 === 0) {
            tbody.appendChild(row);
            row = document.createElement("tr");
        }
    }
    while (row.children.length > 0 && row.children.length < 7) {
        row.appendChild(document.createElement("td"));
    }
    if (row.children.length > 0) tbody.appendChild(row);
}

function selectDate(dateStr) {
    selectedDateStr = dateStr;
    document.getElementById("signingDate").value = dateStr;
    renderCalendar();
}

// ── Time options 8am–5pm, 30-min intervals ──
function populateTimeOptions() {
    const sel = document.getElementById("signingTime");
    sel.innerHTML = '<option value="">Select a time</option>';
    for (let h = 8; h < 17; h++) {
        for (let m = 0; m < 60; m += 30) {
            const val = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
            const label = (h > 12 ? h - 12 : h) + ":" + String(m).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM");
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = label;
            sel.appendChild(opt);
        }
    }
}

// ── Reschedule mode helpers ──
async function loadRescheduleOrder(orderId) {
    const { data, error } = await supabase
        .from("boat_orders")
        .select("*")
        .eq("orderId", orderId)
        .single();
    if (error || !data) { alert("Order not found."); window.location.href = "home.html"; return; }

    boatData = {
        name: data.boatName.replace(" (Custom)", ""),
        price: data.boatPrice,
        buildTime: data.buildTime,
        downpayment: data.downpayment,
        image: data.boatImage
    };
    buildType = data.buildType || "standard";

    document.getElementById("orderBoatImage").src = boatData.image;
    document.getElementById("orderBoatName").textContent = boatData.name;
    document.getElementById("orderBoatPrice").textContent = boatData.price;
    document.getElementById("orderBuildTime").innerHTML = boatData.buildTime || "N/A";
    document.getElementById("orderDownPayment").textContent = boatData.downpayment || "N/A";

    document.querySelector(".build-options").style.display = "none";
    document.querySelector(".panel-desc").style.display = "none";
    document.getElementById("stepIndicator").style.display = "none";
    document.getElementById("stepLabels").style.display = "none";

    const header = document.getElementById("guidelineHeader");
    header.innerHTML = `
        <div class="approved-summary" style="margin-bottom:24px;">
            <h3><i class="fa-solid fa-calendar-check"></i> Reschedule Contract Signing</h3>
            <div class="summary-row"><span>Boat</span><strong>${data.boatName}</strong></div>
            <div class="summary-row"><span>Current Schedule</span><strong>${data.contractSchedule?.date || "N/A"} at ${data.contractSchedule?.time || "N/A"}</strong></div>
        </div>
    `;

    if (data.contractSchedule) {
        document.getElementById("signingLocation").value = data.contractSchedule.location || "";
        document.getElementById("signingNotes").value = data.contractSchedule.notes || "";
    }

    goToStep(4);
    document.getElementById("flowTitle").textContent = "Reschedule - Select New Schedule";
    document.getElementById("finalBoatName").textContent = data.boatName;
    document.getElementById("finalBuildType").textContent = data.buildType === "custom" ? "Custom Build" : "Standard Build";
    document.getElementById("finalPrice").textContent = data.boatPrice;
    document.getElementById("finalBuildTime").textContent = data.buildTime || "N/A";
    document.getElementById("finalDownpayment").textContent = data.downpayment || "N/A";
}

async function submitOrder() {
    const schedule = getScheduleData();
    if (!validateSchedule(schedule)) return;

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || "";
    let customerName = sessionStorage.getItem("customerName") || user?.email?.split('@')[0] || "Customer";
    let customerEmail = sessionStorage.getItem("customerEmail") || user?.email || "";
    if (!sessionStorage.getItem("customerName")) sessionStorage.setItem("customerName", customerName);
    if (!sessionStorage.getItem("customerEmail")) sessionStorage.setItem("customerEmail", customerEmail);
    const phoneInput = document.getElementById("customerPhoneInput");
    const customerPhone = phoneInput ? phoneInput.value.trim() : sessionStorage.getItem("customerPhone") || "";
    if (customerPhone) sessionStorage.setItem("customerPhone", customerPhone);

    const comments = {};
    document.querySelectorAll(".guideline-item").forEach((item, i) => {
        const ta = item.querySelector(".g-comment");
        if (ta && ta.value.trim()) comments[i] = ta.value.trim();
    });

    const isFinalize = new URLSearchParams(window.location.search).get("mode") === "finalize";

    if (isReschedule && rescheduleOrderId) {
        const { error } = await supabase
            .from("boat_orders")
            .update({
                contractSchedule: schedule,
                signature: schedule.signature,
                status: "Pending Signing",
                orderPhase: "Awaiting Contract Signing",
                progress: 5,
                updatedAt: new Date().toISOString()
            })
            .eq("orderId", rescheduleOrderId);
        if (error) { alert("Failed to reschedule: " + error.message); return; }
        sendEmailNotification({ type: "status_changed", recipient: customerEmail, data: { orderId: rescheduleOrderId, customerName, customerEmail, status: "Pending Signing", orderPhase: "Schedule Resubmitted", progress: 5 } });
        sendEmailNotification({ type: "status_changed", recipient: "infinityboatsystem@gmail.com", data: { orderId: rescheduleOrderId, customerName, customerEmail, status: "Pending Signing", orderPhase: "Schedule Resubmitted", progress: 5 } });
        alert("Schedule resubmitted! Please wait for the contract signing appointment.");
        window.location.href = "home.html";
        return;
    }

    if (isFinalize) {
        const finalizingOrder = JSON.parse(localStorage.getItem("finalizingCustomOrder"));
        if (finalizingOrder) {
            const { error } = await supabase
                .from("boat_orders")
                .update({
                    status: "Pending Signing",
                    orderPhase: "Awaiting Contract Signing",
                    progress: 5,
                    ackResponses: ackResponses,
                    ackComments: comments,
                    contractSchedule: schedule,
                    signature: schedule.signature,
                    updatedAt: new Date().toISOString()
                })
                .eq("orderId", finalizingOrder.orderId);
            if (error) { alert("Failed to finalize order: " + error.message); return; }
            localStorage.setItem("lastSubmittedOrder", JSON.stringify(finalizingOrder));
            localStorage.removeItem("finalizingCustomOrder");
            alert("Custom design finalized! Please wait for the contract signing appointment.");
            window.location.href = "home.html";
            return;
        }
        alert("Could not find the order to finalize. Please try again.");
        return;
    }

    const payMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || "Full Payment";

    if (buildType === "custom") {
        const draft = JSON.parse(localStorage.getItem("customBuildDraft") || "{}");
        draft.contractSchedule = schedule;
        draft.guidelineResponses = ackResponses;
        draft.comments = comments;
        draft.paymentMethod = payMethod;
        localStorage.setItem("customBuildDraft", JSON.stringify(draft));
        window.location.href = "boatcust.html";
        return;
    }

    const priceNum = parseFloat(String(boatData.price).replace(/[^0-9.]/g, "")) || 0;
    const downNum = parseFloat(String(boatData.downpayment).replace(/[^0-9.]/g, "")) || 0;
    const remaining = payMethod === "Full Payment" ? priceNum : priceNum - downNum;

    const order = {
        orderId: 'ORD-' + Date.now(),
        userId: userId,
        boatName: boatData.name,
        boatImage: boatData.image,
        boatPrice: String(boatData.price),
        buildTime: boatData.buildTime || "N/A",
        downpayment: boatData.downpayment || "N/A",
        paymentMethod: payMethod,
        customerName: customerName,
        customerEmail: customerEmail,
        customerPhone: customerPhone,
        customerAddress: "",
        validId: "",
        notes: "",
        status: "Pending Signing",
        progress: 0,
        paymentStep: 0,
        remainingBalance: remaining,
        orderPhase: "Awaiting Contract Signing",
        buildType: "standard",
        ackResponses: ackResponses,
        ackComments: comments,
        contractSchedule: schedule,
        signature: schedule.signature,
        createdAt: new Date().toISOString()
    };

    const { error } = await supabase.from("boat_orders").insert(order);
    if (error) { alert("Failed to submit order: " + error.message); return; }
    localStorage.setItem("lastSubmittedOrder", JSON.stringify(order));

    sendEmailNotification({ type: "order_created", recipient: order.customerEmail, data: order });
    sendEmailNotification({ type: "order_created", recipient: "infinityboatsystem@gmail.com", data: order });

    alert("Order submitted successfully! Please wait for the contract signing appointment.");
    window.location.href = "home.html";
}

function saveCustomBuildDraft() {
    const draft = {
        boatData: boatData,
        buildType: "custom",
        ackResponses: ackResponses,
        comments: {},
        createdAt: new Date().toISOString()
    };
    document.querySelectorAll("#guidelineQuestions .guideline-item").forEach((item, i) => {
        const ta = item.querySelector(".g-comment");
        if (ta && ta.value.trim()) draft.comments[i] = ta.value.trim();
    });
    localStorage.setItem("customBuildDraft", JSON.stringify(draft));
}

function getStandardInfoHTML() {
    return `
    <div class="info-page">
        <h3>Boat Information</h3>

        <div class="info-section">
            <h4><i class="fa-solid fa-ship"></i> Boat Specifications</h4>
            <div class="info-grid">
                <div class="info-item"><span>Model</span><strong>${boatData.name}</strong></div>
                <div class="info-item"><span>Price</span><strong>${boatData.price}</strong></div>
                <div class="info-item"><span>Estimated Build Time</span><strong>${boatData.buildTime || "N/A"}</strong></div>
                <div class="info-item"><span>Downpayment Required</span><strong>${boatData.downpayment || "N/A"}</strong></div>
                <div class="info-item"><span>Passenger Capacity</span><strong>12 Persons</strong></div>
                <div class="info-item"><span>Hull Material</span><strong>Fiberglass Reinforced</strong></div>
            </div>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-circle-info"></i> Key Features</h4>
            <p>This boat is built with premium fiberglass materials for durability and performance. It features a spacious cabin, advanced navigation system, comfortable seating, and reliable engine options. Each boat undergoes rigorous quality testing before delivery.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-shield-halved"></i> Warranty Information</h4>
            <p>All boats come with a 1-year structural warranty covering manufacturing defects. Engine and electronic components are covered by their respective manufacturer warranties. Warranty does not cover damage from misuse, accidents, or unauthorized modifications.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-clock"></i> Production & Delivery</h4>
            <p>Estimated build time is ${boatData.buildTime || "as specified"} from order confirmation and downpayment. Delivery schedule will be provided within 2 weeks of order approval. Shipping and handling fees are separate and depend on location.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-file-lines"></i> Terms & Conditions</h4>
            <div class="terms-box">
                <ul>
                    <li>A non-refundable downpayment is required to begin production.</li>
                    <li>Full payment must be completed before boat delivery.</li>
                    <li>Custom changes after order placement may incur additional charges.</li>
                    <li>Production timeline starts after downpayment confirmation.</li>
                    <li>The customer is responsible for transportation and delivery fees.</li>
                    <li>Warranty claims must be submitted within 30 days of issue discovery.</li>
                    <li>The company reserves the right to modify specifications with notice.</li>
                    <li>All disputes shall be resolved under Philippine maritime law.</li>
                </ul>
            </div>
        </div>
    </div>`;
}

function getCustomInfoHTML() {
    return `
    <div class="info-page">
        <h3>Customization Information</h3>

        <div class="info-section">
            <h4><i class="fa-solid fa-wand-magic-sparkles"></i> Customization Process</h4>
            <p>Our 3D Boat Customizer allows you to modify various aspects of your boat, including dimensions, engine type, seating capacity, LED lighting, and hull color. All customizations are applied in real-time with instant pricing updates. Once you submit your design, it enters the engineering review process.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-gears"></i> Engineering Review</h4>
            <p>Every custom design is evaluated by our engineering team to ensure structural integrity, safety compliance, and manufacturability. The review process may take 3-7 business days. Designs that pass review are approved for production; designs needing changes receive feedback for revisions.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-coins"></i> Additional Costs</h4>
            <p>Customizations may increase the final price beyond the base boat cost. The 3D customizer displays real-time pricing for each modification. Engineering review and design validation are included in the customization service. Major structural changes may incur additional engineering fees.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-calendar-clock"></i> Timeline Considerations</h4>
            <p>Custom builds typically require additional production time compared to standard builds. The engineering review adds 3-7 business days. Production timelines vary based on the complexity of customizations. You will receive an updated delivery estimate upon design approval.</p>
        </div>

        <div class="info-section">
            <h4><i class="fa-solid fa-file-shield"></i> Customization Policies</h4>
            <div class="terms-box">
                <ul>
                    <li>All custom designs are subject to engineering approval before production.</li>
                    <li>Customizations may affect the standard warranty coverage.</li>
                    <li>Additional costs for customizations must be settled before production begins.</li>
                    <li>Design revisions requested after submission may extend review time.</li>
                    <li>Approved designs that proceed to payment become final and cannot be modified.</li>
                    <li>The company reserves the right to reject designs that are not structurally feasible.</li>
                    <li>Custom orders are non-cancellable once production has started.</li>
                    <li>Delivery timelines for custom builds are estimates and subject to change.</li>
                </ul>
            </div>
        </div>
    </div>`;
}

window.addEventListener("DOMContentLoaded", init);
