import { supabase, handleDbError, sendEmailNotification } from "./supabase.js";
import {
  BOAT_SPECS,
  BOAT_MATERIALS,
  BOAT_SIMPLE_MATERIALS,
  BOAT_ACTIVITIES,
  BOAT_TIMELINE,
  BOAT_DELIVERY_INFO,
  getBoatSpecs as _getBoatSpecs,
  getBoatMaterials as _getBoatMaterials,
  getBoatSimpleMaterials as _getBoatSimpleMaterials,
  getBoatActivities as _getBoatActivities,
  getBoatTimeline as _getBoatTimeline,
  getBoatDeliveryInfo as _getBoatDeliveryInfo,
  getBoatMilestones
} from "./boatData.js";

function esc(str) {
  const el = document.createElement('div');
  el.textContent = str ?? '';
  return el.innerHTML;
}
let gOrders = [];

function getOrders() { return gOrders; }

function setOrders(val) { gOrders = val; }

async function saveOrders() {
  for (const o of gOrders) {
    await handleDbError(
      supabase.from("boat_orders").upsert(
        { orderId: o.orderId, ...o },
        { onConflict: "orderId" }
      ),
      "Saving orders"
    );
  }
}

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

const SPECIALTY_ICONS = {
  engineer: "fa-user-gear",
  builder: "fa-hard-hat",
  welder: "fa-wrench",
  electrician: "fa-bolt",
  painter: "fa-paint-roller",
  "fiberglass specialist": "fa-fill-drip",
};

function getSpecialtyClass(role) {
  return (role || "").toLowerCase().replace(/\s+/g, "-");
}

function getSpecialtyIcon(role) {
  const key = (role || "").toLowerCase();
  for (const [k, icon] of Object.entries(SPECIALTY_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return "fa-user";
}

window.addEventListener("DOMContentLoaded", async () => {
    const customerEmail = localStorage.getItem("customerEmail");
    if (!customerEmail) {
        window.location.href = "login.html";
        return;
    }

    let customerName = localStorage.getItem("customerName");

    const { data: freshProfile } = await supabase.from("profiles").select("name, phone").eq("id", localStorage.getItem("userId")).single();
    if (freshProfile?.name) {
        customerName = freshProfile.name;
        localStorage.setItem("customerName", freshProfile.name);
    }
    if (freshProfile?.phone) localStorage.setItem("customerPhone", freshProfile.phone);

    /* =============================================
       STATIC DATA (centralized in boatData.js)
    ============================================= */

    const PENALTY_STAGES = [
        { label: "Design Phase", min: 0, max: 10, penalty: "10%", feeRate: 0.10 },
        { label: "MARINA Processing", min: 11, max: 40, penalty: "20%", feeRate: 0.20 },
        { label: "Construction Phase", min: 41, max: 70, penalty: "50%", feeRate: 0.50 },
        { label: "Near Completion", min: 71, max: 100, penalty: "Non-Refundable", feeRate: 1.0 }
    ];

    const PAYMENT_PHASES = [
        { label: "30% Down Payment", percentage: 30, step: 0, description: "Boat reservation and initial construction." },
        { label: "40% Mid-Construction", percentage: 40, step: 1, description: "Main structure and assembly process." },
        { label: "30% Full Billing", percentage: 30, step: 2, description: "Final payment before delivery." }
    ];

    const FULL_PAYMENT_PHASES = [
        { label: "100% Full Payment", percentage: 100, step: 0, description: "One-time full payment for the boat." }
    ];

        /* =============================================
       DATA HELPERS
    ============================================= */

    function migrateOrderData(order) {
        if (!order.milestones) {
            const boatMs = getBoatMilestones(order.boatName);
            order.milestones = boatMs.map(m => ({
                label: m.label, percentage: m.percentage,
                completed: (order.progress || 0) >= m.percentage,
                completedDate: (order.progress || 0) >= m.percentage ? (order.projectCompletedDate || null) : null,
                history: []
            }));
        }
        if (!order.activityLog || order.activityLog.length === 0) {
            const defaultActivities = getBoatActivities(order.boatName);
            const progress = order.progress || 0;
            order.activityLog = defaultActivities.map((a, i) => {
                const activityProgress = Math.round(((i + 1) / defaultActivities.length) * 100);
                const isCompleted = progress >= activityProgress;
                const isInProgress = !isCompleted && progress >= (activityProgress - Math.round(100 / defaultActivities.length));
                return {
                    title: a.title,
                    description: a.description,
                    date: new Date(Date.now() - (defaultActivities.length - i) * 86400000 * 3).toISOString(),
                    personnel: isCompleted ? "System" : isInProgress ? "In Progress" : "Pending",
                    role: a.department,
                    status: isCompleted ? "completed" : isInProgress ? "in-progress" : "pending"
                };
            });
        }
        if (!order.deliveryInfo) order.deliveryInfo = {};
        if (!order.warrantyInfo) order.warrantyInfo = { warrantyPeriod: "1 Year", coverage: "Hull and structural defects" };
        if (!order.documents) order.documents = [];
        if (!order.budgetInfo) {
            order.budgetInfo = order.customConfig ? {
                clientBudget: 0,
                designCost: order.customConfig ? parseInt(String(order.customConfig.totalPrice || "0").replace(/[^0-9]/g, "")) : 0,
                suggestions: ["Use standard seating configuration", "Remove premium roof options", "Select standard paint finish"]
            } : {};
        }
        if (!order.paymentHistory) order.paymentHistory = [];
        if (!order.customerRestriction) order.customerRestriction = "Good Standing";
        if (!order.projectCompletedDate && order.status === "Completed") order.projectCompletedDate = new Date().toISOString();
        return order;
    }

    function getMilestones(order) {
        return order.milestones || [];
    }

    function getActivityLog(order) {
        return order.activityLog || [];
    }

    function getBoatSpecs(boatName) {
        if (boatName && BOAT_SPECS[boatName]) return BOAT_SPECS[boatName];
        const match = Object.keys(BOAT_SPECS).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
        return match ? BOAT_SPECS[match] : BOAT_SPECS["Passenger Boat"];
    }

    function getBoatMaterials(boatName) {
        if (boatName && BOAT_MATERIALS[boatName]) return BOAT_MATERIALS[boatName];
        const match = Object.keys(BOAT_MATERIALS).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
        return match ? BOAT_MATERIALS[match] : BOAT_MATERIALS["Passenger Boat"];
    }

    function getBoatSimpleMaterials(boatName) {
        if (boatName && BOAT_SIMPLE_MATERIALS[boatName]) return BOAT_SIMPLE_MATERIALS[boatName];
        const match = Object.keys(BOAT_SIMPLE_MATERIALS).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
        return match ? BOAT_SIMPLE_MATERIALS[match] : BOAT_SIMPLE_MATERIALS["Passenger Boat"];
    }

    function getBoatActivities(boatName) {
        if (boatName && BOAT_ACTIVITIES[boatName]) return BOAT_ACTIVITIES[boatName];
        const match = Object.keys(BOAT_ACTIVITIES).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
        return match ? BOAT_ACTIVITIES[match] : BOAT_ACTIVITIES["Passenger Boat"];
    }

    function getPaymentPhases(order) {
        const phases = order && order.paymentMethod === "Full Payment" ? FULL_PAYMENT_PHASES : PAYMENT_PHASES;
        return phases.map((p, i) => ({
            ...p,
            completed: (order.paymentStep || 0) > i,
            current: (order.paymentStep || 0) === i
        }));
    }

    function getPenaltyInfo(progress) {
        const p = progress || 0;
        for (const stage of PENALTY_STAGES) {
            if (p >= stage.min && p <= stage.max) return stage;
        }
        return PENALTY_STAGES[PENALTY_STAGES.length - 1];
    }

    function getProjectStage(progress) {
        const p = progress || 0;
        if (p <= 10) return "Design Phase";
        if (p <= 40) return "MARINA Processing";
        if (p <= 70) return "Construction Phase";
        if (p <= 99) return "Near Completion";
        return "Completed";
    }

    function getProjectDuration(order) {
        if (order.buildTime) return order.buildTime;
        const tl = _getBoatTimeline(order.boatName);
        return tl.totalDuration;
    }

    function getEstimatedCompletionDate(order) {
        if (order.deliveryInfo?.expectedDate && order.deliveryInfo?.expectedDate !== "To be determined") {
            return order.deliveryInfo.expectedDate;
        }
        const startDate = order.createdAt ? new Date(order.createdAt) : new Date();
        const durStr = getProjectDuration(order);
        const months = parseBuildDurationToMonths(durStr);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + months);
        const opts = { year: "numeric", month: "long", day: "numeric" };
        return endDate.toLocaleDateString("en-US", opts);
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

    function getEstimatedTimeline(order) {
        const tl = _getBoatTimeline(order.boatName);
        const phaseCount = tl.phases.length;
        const step = 100 / phaseCount;
        return tl.phases.map((p, i) => {
            const parts = p.split(" - ");
            return {
                phase: parts[0],
                duration: parts[1] || "",
                percentage: Math.round((i + 1) * step),
                startPct: Math.round(i * step)
            };
        });
    }

    function getDeliveryInfo(order) {
        const info = order.deliveryInfo || {};
        const dl = _getBoatDeliveryInfo(order.boatName);
        const estimatedDate = getEstimatedCompletionDate(order);
        return {
            expectedDate: (info.expectedDate && info.expectedDate !== "To be determined") ? info.expectedDate : estimatedDate,
            committedDate: info.committedDeliveryDate || "",
            actualDate: info.actualDeliveryDate || "",
            deliveryStatus: info.deliveryStatus || "Preparing for Delivery",
            deliveryProgress: info.deliveryProgress || 0,
            deliveryLocation: info.deliveryLocation || "To be confirmed",
            contactPerson: info.contactPerson || "To be assigned",
            seaTrialResults: info.seaTrialResults || "Pending",
            deliveryConfirmed: info.deliveryConfirmed || false,
            delayDays: info.delayDays || 0,
            delayPenalty: info.delayPenalty || 0,
            delayPenaltyPercent: info.delayPenaltyPercent || 0,
            delayReason: info.delayReason || "",
            standardLeadTime: dl.standardLeadTime,
            deliveryMethod: dl.deliveryMethod,
            seaTrialDuration: dl.seaTrialDuration,
            preparationDays: dl.preparationDays,
            trainingDays: dl.trainingDays
        };
    }

    function getFullPaymentStatus(order) {
        const price = parseFloat(String(order.boatPrice).replace(/[^0-9.]/g, "")) || 0;
        const paid = getAmountPaidForOrder(order.orderId);
        return price > 0 && paid >= price;
    }

    const _paidCache = {};
    function cacheAmountPaid(orderId, amount) {
        _paidCache[orderId] = amount;
    }
    function getAmountPaidForOrder(orderId) {
        return _paidCache[orderId] || 0;
    }

    const nameEl = document.getElementById("homeName");
    if (customerName) nameEl.textContent = customerName;

    const greetingEl = document.getElementById("welcomeGreeting");
    const lastVisit = localStorage.getItem("lastLoginDate");
    const now = new Date().toISOString();
    if (!lastVisit) {
        if (greetingEl) greetingEl.textContent = "Welcome";
    } else {
        if (greetingEl) greetingEl.textContent = "Welcome back";
    }
    localStorage.setItem("lastLoginDate", now);

    const profilePic = document.getElementById("profilePic");
    const savedImage = localStorage.getItem("customerImage");
    if (savedImage && profilePic) profilePic.src = savedImage;

    const paymentSuccessMsg = localStorage.getItem("paymentSuccess");
    if (paymentSuccessMsg) {
        const heroCard = document.querySelector(".hero-card");
        if (heroCard) {
            const banner = document.createElement("div");
            banner.className = "payment-success-banner";
            banner.innerHTML = `
                <i class="fa-solid fa-circle-check"></i>
                <span>${paymentSuccessMsg}</span>
                <button class="banner-close" onclick="this.parentElement.remove();">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            heroCard.insertBefore(banner, heroCard.firstChild);
        }
        localStorage.removeItem("paymentSuccess");
    }

    const { data: allOrdersData } = await handleDbError(
      supabase
        .from("boat_orders")
        .select("*")
        .order("createdAt", { ascending: false }),
      "Loading orders"
    );
    setOrders(allOrdersData || []);
    const allOrders = getOrders();
    const userOrders = allOrders.filter(o =>
        o.customerEmail === customerEmail ||
        o.customerName === customerName
    );
    const myOrders = userOrders.filter(o => o.status !== "Cancelled");
    let cancelledOrders = userOrders.filter(o => o.status === "Cancelled");

    myOrders.forEach(migrateOrderData);

    const emptyStateHTML = document.getElementById("emptyState")?.innerHTML || "";
    let currentFilter = "all";
    await updateStats(myOrders, cancelledOrders.length, cancelledOrders);
    await applyFilter("all", myOrders);
    renderCancelledOrders(cancelledOrders);

    /* =============================================
       REALTIME: Listen for admin changes
    ============================================= */

    const customerEmailForRealtime = customerEmail;
    const customerNameForRealtime = customerName;

    const rtChannel = supabase.channel("home-realtime-" + (customerEmail || "anon"));
    rtChannel.on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "boat_orders" },
        async (payload) => {
            try {
                const updated = payload.new;
                const matchesUser =
                    (customerEmailForRealtime && updated.customerEmail === customerEmailForRealtime) ||
                    (customerNameForRealtime && updated.customerName === customerNameForRealtime);

                if (!matchesUser) return;

                const allOrders = getOrders();
                const idx = allOrders.findIndex(o => o.orderId === updated.orderId);
                if (idx !== -1) {
                    allOrders[idx] = updated;
                } else {
                    allOrders.unshift(updated);
                }
                setOrders(allOrders);

                const userOrders = allOrders.filter(o =>
                    (o.customerEmail === customerEmailForRealtime || o.customerName === customerNameForRealtime)
                );
                const myOrders = userOrders.filter(o => o.status !== "Cancelled");
                cancelledOrders = userOrders.filter(o => o.status === "Cancelled");
                myOrders.forEach(migrateOrderData);
                await updateStats(myOrders, cancelledOrders.length, cancelledOrders);
                await applyFilter(currentFilter, myOrders);
                renderCancelledOrders(cancelledOrders);

                const status = updated.status || "";
                if (status === "Approved" || status === "Rejected" || status === "Completed" || status === "Schedule Rejected" || status === "Revision Required") {
                    showToast(`Your order "${updated.boatName}" was updated to: ${status}`, status === "Approved" || status === "Completed" ? "success" : "warning");
                    notifySound();
                }
            } catch (e) {
                console.error("Realtime UPDATE handler error:", e);
            }
        }
    );

    rtChannel.on("postgres_changes",
        { event: "INSERT", schema: "public", table: "boat_orders" },
        async (payload) => {
            try {
                const inserted = payload.new;
                const matchesUser =
                    (customerEmailForRealtime && inserted.customerEmail === customerEmailForRealtime) ||
                    (customerNameForRealtime && inserted.customerName === customerNameForRealtime);
                if (!matchesUser) return;

                const allOrders = getOrders();
                allOrders.unshift(inserted);
                setOrders(allOrders);

                const userOrders = allOrders.filter(o =>
                    (o.customerEmail === customerEmailForRealtime || o.customerName === customerNameForRealtime)
                );
                const myOrders = userOrders.filter(o => o.status !== "Cancelled");
                cancelledOrders = userOrders.filter(o => o.status === "Cancelled");
                myOrders.forEach(migrateOrderData);
                await updateStats(myOrders, cancelledOrders.length, cancelledOrders);
                await applyFilter(currentFilter, myOrders);
                renderCancelledOrders(cancelledOrders);

                showToast(`New order created: ${inserted.boatName || "Boat"}`, "success");
                notifySound();
            } catch (e) {
                console.error("Realtime INSERT handler error:", e);
            }
        }
    );

    rtChannel.subscribe();

    const workersChannel = supabase.channel("home-workers-" + (customerEmail || "anon"));
    workersChannel.on("postgres_changes",
        { event: "*", schema: "public", table: "project_workers" },
        () => {
            const allOrders = getOrders();
            const userOrders = allOrders.filter(o =>
                (o.customerEmail === customerEmail || o.customerName === customerName)
            );
            const myOrders = userOrders.filter(o => o.status !== "Cancelled");
            applyFilter(currentFilter, myOrders);
        }
    );
    workersChannel.subscribe();

    async function updateStats(orders, cancelledCount, cancelledOrders) {
        const total = orders.length;
        const active = orders.filter(o => o.status !== "Completed" && o.status !== "Rejected" && o.status !== "Cancelled").length;
        const completed = orders.filter(o => o.status === "Completed").length;

        document.getElementById("totalProjects").textContent = total;
        document.getElementById("activeProjects").textContent = active;
        document.getElementById("completedProjects").textContent = completed;

        const cancelledEl = document.getElementById("cancelledProjects");
        if (cancelledEl) {
            cancelledEl.textContent = cancelledCount || 0;
            cancelledEl.closest(".stat-card").style.display = "block";
        }

        const orderIds = orders.map(o => o.orderId).filter(Boolean);
        let amountPaid = 0;
        let totalContract = 0;

        if (orderIds.length > 0) {
            const { data: payments } = await handleDbError(
                supabase
                    .from("dashboard_payments")
                    .select("orderId, amount")
                    .in("orderId", orderIds)
                    .eq("status", "Approved"),
                "Fetching approved payments"
            );
            const paidPerOrder = {};
            if (payments && payments.length > 0) {
                payments.forEach(p => {
                    paidPerOrder[p.orderId] = (paidPerOrder[p.orderId] || 0) + (Number(p.amount) || 0);
                });
                amountPaid = Object.values(paidPerOrder).reduce((sum, a) => sum + a, 0);
            }
            orderIds.forEach(oid => cacheAmountPaid(oid, paidPerOrder[oid] || 0));
        }

        orders.forEach(o => {
            const price = parseFloat(String(o.boatPrice).replace(/[^0-9.]/g, "")) || 0;
            totalContract += price;
        });

        const remaining = Math.max(0, totalContract - amountPaid);

        document.getElementById("totalPayment").textContent = "\u20B1" + amountPaid.toLocaleString();
        document.getElementById("remainingPayment").textContent = "\u20B1" + remaining.toLocaleString();
    }

    async function renderProjects(orders) {
        const ordersGrid = document.getElementById("myOrdersGrid");
        if (!ordersGrid) return;
        ordersGrid.innerHTML = "";

        const orderIds = orders.map(o => o.orderId).filter(Boolean);
        const paidMap = {};
        const pendingMap = {};
        if (orderIds.length > 0) {
            try {
                const { data: allPayments } = await handleDbError(
                    supabase
                        .from("dashboard_payments")
                        .select("orderId, amount, status")
                        .in("orderId", orderIds),
                    "Fetching payments for project cards"
                );
                if (allPayments && allPayments.length > 0) {
                    allPayments.forEach(p => {
                        if (p.status === "Approved") {
                            paidMap[p.orderId] = (paidMap[p.orderId] || 0) + (Number(p.amount) || 0);
                        } else if (p.status === "Pending") {
                            pendingMap[p.orderId] = true;
                        }
                    });
                }
            } catch (e) {
                console.error("Failed to fetch payments for cards:", e);
            }
        }

        for (const [idx, order] of orders.entries()) {
            const statusClass = getStatusClass(order.status);
            let progress = Number(order.progress) || 0;
            const phase = order.orderPhase || "Pending Approval";
            const workers = await getWorkersForOrder(order);
            const isCompleted = order.status === "Completed";
            const isCompletedPassenger = isCompleted && order.boatName?.toLowerCase().includes("passenger");
            const orderPrice = parseFloat(String(order.boatPrice).replace(/[^0-9.]/g, "")) || 0;

            let orderPaid = paidMap[order.orderId] || 0;
            if (!orderPaid && order.paymentHistory && order.paymentHistory.length > 0) {
                orderPaid = order.paymentHistory
                    .filter(h => h.status === "Approved")
                    .reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
            }


            if (orderPaid <= 0 && progress > 0 && !isCompleted) {
                progress = 0;
            }
            cacheAmountPaid(order.orderId, orderPaid);

            const buildStage = getBuildStage(progress, order.status, order);
            const orderRemaining = order.remainingBalance != null
                ? Math.max(0, Number(order.remainingBalance) || 0)
                : Math.max(0, orderPrice - orderPaid);

            const isFullyPaid = orderRemaining <= 0 && orderPrice > 0;
            const hidePayBtn = isFullyPaid;
            const hasPendingPayment = !!pendingMap[order.orderId];
            const restriction = order.customerRestriction || "Good Standing";
            const specs = getBoatSpecs(order.boatName);
            const materials = getBoatMaterials(order.boatName);
            const cs = window.parseContractSchedule(order);

            const card = document.createElement("div");
            card.className = "project-card";
            card.dataset.orderId = order.orderId || (order.boatName + (order.createdAt || idx));

            card.innerHTML = `
                <div class="project-image-container">
                    <img class="project-image" src="${esc(order.boatImage || "./images/boat2.jpg")}" alt="${esc(order.boatName || "Boat")}">
                </div>
                <div class="project-content">
                    <div class="project-header">
                        <div>
                            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                                <h2 class="project-title">${esc(order.boatName || "Boat")}</h2>
                                ${isCompleted ? '<span class="completed-badge"><i class="fa-solid fa-check-circle"></i> Completed</span>' : ''}
                                ${restriction && restriction !== "Good Standing" ? `<span class="restriction-badge restriction-${esc(restriction.toLowerCase().replace(/\s+/g, '-'))}">${esc(restriction)}</span>` : ''}
                            </div>
                            <p class="project-subtitle">${esc(phase)}</p>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <button class="minimize-btn" title="Minimize">−</button>
                            <span class="project-status ${statusClass}">${esc(order.status || "Pending")}</span>
                        </div>
                    </div>
                    <div class="project-content-body">

                    <div class="project-details">
                        <div class="detail-box">
                            <span>Payment Type</span>
                            <h4>${esc(order.paymentMethod || "N/A")}</h4>
                        </div>
                        ${isFullyPaid ? `
                        <div class="detail-box" style="background:#f0fdf4;border-color:#bbf7d0;">
                            <span>Payment Status</span>
                            <h4 style="color:#16a34a;">Fully Paid</h4>
                        </div>` : `
                        <div class="detail-box">
                            <span>Remaining</span>
                            <h4>&#8369;${orderRemaining.toLocaleString()}</h4>
                        </div>`}
                        <div class="detail-box">
                            <span>Build Time</span>
                            <h4>${esc(order.buildTime || "N/A")}</h4>
                        </div>
                    </div>

                    ${!isCompleted && order.status !== "Rejected" && order.status !== "Pending Signing" && order.status !== "Pending" && orderPrice > 0 && !isFullyPaid ? `
                    <div style="background:#f8fafc;border-radius:14px;padding:12px;margin-bottom:14px;border:1px solid #e2e8f0;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span style="font-size:12px;color:#64748b;font-weight:600;">PAYMENT BREAKDOWN</span>
                            <span style="font-size:12px;color:#2563eb;">${isFullyPaid ? 'Fully Paid' : 'Remaining: ₱' + orderRemaining.toLocaleString()}</span>
                        </div>
                        ${getPaymentPhases(order).map((phase, pi) => {
                            const phaseAmount = Math.round(orderPrice * phase.percentage / 100);
                            const isDone = phase.completed || (pi === 0 && isFullyPaid);
                            return `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;${!isDone ? 'border-top:1px solid #e2e8f0;' : ''}">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    ${isDone
                                        ? '<span style="color:#22c55e;font-size:14px;"><i class="fa-solid fa-circle-check"></i></span>'
                                        : phase.current && !isFullyPaid
                                        ? '<span style="color:#f59e0b;font-size:14px;"><i class="fa-solid fa-clock"></i></span>'
                                        : '<span style="color:#94a3b8;font-size:14px;"><i class="fa-regular fa-circle"></i></span>'}
                                    <span style="font-size:13px;color:${isDone ? '#16a34a' : '#334155'};">${esc(phase.label)}</span>
                                </div>
                                <span style="font-size:13px;font-weight:600;color:${isDone ? '#16a34a' : '#0f172a'};">${isDone ? 'Paid' : '₱' + phaseAmount.toLocaleString()}</span>
                            </div>`;
                        }).join('')}
                    </div>` : ''}

                    ${isFullyPaid && !isCompleted ? `
                    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:12px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                            <i class="fa-solid fa-shield-halved" style="color:#16a34a;font-size:16px;"></i>
                            <span style="font-size:12px;color:#16a34a;font-weight:600;">FULLY PAID — MONITORING MODE</span>
                        </div>
                        <p style="font-size:13px;color:#166534;">All payments have been settled. You can track your boat's construction progress below.</p>
                    </div>` : ''}

                    <div class="build-progress-container">
                        <div class="circle-progress" style="background: conic-gradient(${isCompleted ? '#22c55e' : '#2563eb'} 0% ${progress}%, #dbeafe ${progress}% 100%);">
                            <div class="circle-inner">
                                <span style="color:${isCompleted ? '#16a34a' : '#2563eb'}">${progress}%</span>
                            </div>
                        </div>
                        <div class="build-progress-info">
                            <h4>Current Build Update</h4>
                            <p>${esc(buildStage)}</p>
                            <span>${esc(getBuildWeeks(progress))}</span>
                        </div>
                    </div>

                    <div class="progress-wrapper">
                        <div class="progress-top">
                            <span>Build Progress</span>
                            <span>${progress}%</span>
                        </div>
                        <div class="modern-progress">
                            <div class="modern-progress-fill" style="width:${progress}%;background:${isCompleted ? 'linear-gradient(90deg,#22c55e,#16a34a)' : ''};"></div>
                        </div>
                    </div>

                    ${renderProjectTabButtons(idx)}

                    <div class="project-tab-content" id="projectTabContent${idx}">
                        ${renderMilestonesSection(order, idx)}
                    </div>

                    ${renderWarrantySection(order)}

                    <div class="workers-section">
                        <div class="workers-header">
                            <h4>Workers <span style="font-weight:400;color:#64748b;font-size:13px;">(${workers.length})</span></h4>
                            <button class="view-all-btn" data-order-idx="${idx}">View All</button>
                        </div>
                        <div class="workers-list" id="workersPreview${idx}"></div>
                    </div>

                    ${order.buildType === "custom" ? `
                    <div class="timeline">
                        <div class="timeline-item ${progress >= 0 ? "active" : ""}">Design Submitted</div>
                        <div class="timeline-item ${order.status === "Under Review" || order.status === "Approved" || order.status === "Revision Required" || progress >= 5 ? "active" : ""}">Under Review</div>
                        <div class="timeline-item ${order.status === "Approved" || progress >= 10 ? "active" : ""}">Approved</div>
                        <div class="timeline-item ${progress >= 25 ? "active" : ""}">Construction</div>
                        <div class="timeline-item ${progress >= 100 ? "active" : ""}">Delivery</div>
                    </div>` : `
                    <div class="timeline">
                        <div class="timeline-item ${progress >= 0 ? "active" : ""}">Order Submitted</div>
                        <div class="timeline-item ${order.status === "Pending Signing" || progress >= 5 ? "active" : ""}">Contract Signing</div>
                        <div class="timeline-item ${progress >= 10 ? "active" : ""}">Approved</div>
                        <div class="timeline-item ${progress >= 25 ? "active" : ""}">Construction</div>
                        <div class="timeline-item ${progress >= 100 ? "active" : ""}">Delivery</div>
                    </div>`}
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:14px;font-size:12px;">
                        <span style="color:#64748b;"><i class="fa-solid fa-calendar-plus"></i> Ordered: ${order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}</span>
                        <span style="color:#16a34a;font-weight:600;"><i class="fa-solid fa-calendar-check"></i> Est. Completion: ${esc(getEstimatedCompletionDate(order))}</span>
                    </div>

                    ${(order.status === "Pending Signing" || (order.buildType === "custom" && order.status === "Approved" && order.orderPhase === "Custom Design Approved")) && cs ? `
                    <div class="project-actions" style="margin-bottom:12px;">
                        <button class="payment-btn" style="background:#f59e0b;cursor:default;" disabled>Awaiting Schedule Approval</button>
                    </div>
                    <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:14px;padding:14px;">
                        <h4 style="font-size:13px;color:#1d4ed8;margin-bottom:6px;">Proposed Signing Schedule</h4>
                        <p style="font-size:13px;color:#334155;">${esc(window.formatScheduleDateTime(cs.date, cs.time))}</p>
                        <p style="font-size:13px;color:#334155;">Location: ${esc(cs.location)}</p>
                        ${cs.notes ? `<p style="font-size:13px;color:#64748b;margin-top:4px;">Notes: ${esc(cs.notes)}</p>` : ""}
                        ${(cs.signature || order.signature) ? `<p style="font-size:13px;color:#1d4ed8;margin-top:4px;"><i class="fa-solid fa-pen"></i> Signed: <span style="font-family:cursive;">${esc(cs.signature || order.signature)}</span></p>` : ""}
                    </div>` : order.status === "Schedule Rejected" ? `
                    <div class="project-actions" style="margin-bottom:12px;">
                        <button class="payment-btn" data-action="resubmit-schedule" onclick="resubmitSchedule('${esc(order.orderId)}')"><i class="fa-solid fa-calendar"></i> Resubmit Schedule</button>
                    </div>` : order.buildType === "custom" && order.status === "Approved" && !cs ? `
                    <div class="project-actions">
                        <button class="payment-btn" onclick="finalizeCustomOrder('${esc(order.orderId)}')">Proceed to Finalize</button>
                    </div>` : order.buildType === "custom" && order.status === "Under Review" ? `
                    <div class="project-actions">
                        <button class="payment-btn" style="background:#94a3b8;cursor:not-allowed;" disabled>Awaiting Review</button>
                    </div>` : order.status === "Revision Required" ? `
                    <div class="project-actions">
                        <button class="payment-btn" data-action="revise-design" onclick="reviseDesign('${esc(order.orderId)}')"><i class="fa-solid fa-pen"></i> Revise Design</button>
                    </div>` : !isCompleted && !hidePayBtn && orderRemaining > 0 && order.status !== "Rejected" && order.status !== "Schedule Rejected" && order.status !== "Under Review" && order.status !== "Pending" && order.status !== "Pending Signing" && order.status !== "Revision Required" ? `
                    <div class="project-actions">
                        ${hasPendingPayment
                            ? `<button class="payment-btn" style="background:#f59e0b;cursor:default;" disabled><i class="fa-solid fa-hourglass-half"></i> Payment Pending Approval</button>`
                            : `<button class="payment-btn" data-order-id="${esc(order.orderId)}">Proceed To Payment</button>`
                        }
                    </div>` : ""}

                    ${isCompleted && !isFullyPaid && !isCompletedPassenger ? `
                    <div class="project-actions">
                        <button class="payment-btn" style="background:#f59e0b;cursor:default;" disabled><i class="fa-solid fa-exclamation-circle"></i> Project Completed — Remaining: ₱${orderRemaining.toLocaleString()}</button>
                    </div>` : isCompleted ? `
                    <div class="project-actions">
                        <button class="payment-btn" style="background:#22c55e;cursor:default;" disabled><i class="fa-solid fa-check"></i> All Payments Settled</button>
                    </div>` : ""}

                    <div class="project-actions" style="margin-top:8px;">
                        <button class="cancel-btn summary-btn" data-action="summary" data-order-idx="${idx}" style="border-color:#6366f1;color:#6366f1;background:#f5f3ff;"><i class="fa-solid fa-receipt"></i> Order Summary</button>
                    </div>

                    ${order.reviewFeedback ? `
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:14px;margin-top:14px;">
                        <h4 style="font-size:13px;color:#92400e;margin-bottom:4px;">${esc(order.status === "Rejected" ? "Design Rejected" : order.status === "Schedule Rejected" ? "Schedule Rejected" : "Revision Feedback")}</h4>
                        <p style="font-size:13px;color:#78350f;">${esc(order.reviewFeedback)}</p>
                    </div>` : ""}

                    ${order.status === "Cancellation Requested" ? `
                    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:14px;padding:14px;margin-top:12px;">
                        <h4 style="font-size:13px;color:#dc2626;margin-bottom:4px;"><i class="fa-solid fa-clock"></i> Cancellation Requested</h4>
                        <p style="font-size:13px;color:#991b1b;">Reason: ${esc(order.cancelReason || "N/A")}</p>
                        ${(order.cancelFee > 0 && !order.cancelPaidAt) ? `
                        <p style="font-size:13px;color:#dc2626;margin-top:4px;">Cancellation fee: ₱${Number(order.cancelFee).toLocaleString()}</p>
                        <button class="payment-btn" data-action="resume-cancel" data-order-id="${esc(order.orderId)}" style="margin-top:8px;font-size:13px;">Pay Cancellation Fee</button>
                        ` : `<p style="font-size:13px;color:#64748b;margin-top:4px;">Processing...</p>`}
                    </div>` : order.status === "Cancelled" ? `
                    <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:14px;padding:14px;margin-top:12px;">
                        <h4 style="font-size:13px;color:#475569;margin-bottom:4px;"><i class="fa-solid fa-ban"></i> Order Cancelled</h4>
                        <p style="font-size:13px;color:#334155;">${order.cancelReason ? "Reason: " + esc(order.cancelReason) : ""}</p>
                        ${order.cancelFee ? `<p style="font-size:13px;color:#dc2626;margin-top:4px;">Cancellation fee: ₱${Number(order.cancelFee).toLocaleString()}</p>` : ""}
                    </div>` : (order.status === "Approved" && !isCompleted) ? `
                    <div class="project-actions" style="margin-top:10px;">
                        <button class="cancel-btn" data-action="cancel" data-order-id="${esc(order.orderId)}">Cancel Order</button>
                    </div>` : ""}
                </div>
                </div>
            `;

            ordersGrid.appendChild(card);

            renderWorkersPreview(workers, `workersPreview${idx}`);

            const minimizeBtn = card.querySelector(".minimize-btn");
            minimizeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                card.classList.toggle("collapsed");
                minimizeBtn.textContent = card.classList.contains("collapsed") ? "+" : "−";
            });

            card.addEventListener("click", (e) => {
                if (card.classList.contains("collapsed") && !e.target.closest(".minimize-btn")) {
                    card.classList.remove("collapsed");
                    card.querySelector(".minimize-btn").textContent = "−";
                }
            });

            const summaryBtn = card.querySelector(".summary-btn");
            if (summaryBtn) {
                summaryBtn.addEventListener("click", () => {
                    openOrderSummary(order, workers);
                });
            }

            const viewAllBtn = card.querySelector(".view-all-btn");
            viewAllBtn.addEventListener("click", () => {
                openWorkersModal(workers, order.boatName || "Boat");
            });

            const tabBtn = card.querySelector(".project-tab-btn");
            if (tabBtn) {
                tabBtn.closest(".project-tabs")?.querySelectorAll(".project-tab-btn").forEach(btn => {
                    btn.addEventListener("click", () => {
                        switchProjectTab(card, btn.dataset.tab, idx);
                    });
                });
            }
        }
    }

    /* =============================================
       CANCELLED ORDERS
    ============================================= */

    function renderCancelledOrders(orders) {
        const section = document.getElementById("cancelledSection");
        const grid = document.getElementById("cancelledOrdersGrid");
        if (!section || !grid) return;

        if (orders.length === 0) {
            section.style.display = "none";
            return;
        }

        section.style.display = "block";
        grid.innerHTML = "";

        for (const order of orders) {
            const price = parseFloat(String(order.boatPrice).replace(/[₱,]/g, '')) || 0;
            const fee = Number(order.cancelFee) || 0;
            const penalty = getPenaltyInfo(order.progress || 0);
            const materials = order.cancelMaterials && order.cancelMaterials.length
                ? order.cancelMaterials
                : getCancelMaterials(order.progress || 0);

            const card = document.createElement("div");
            card.className = "project-card";
            card.innerHTML = `
                <div class="project-image-container">
                    <img class="project-image" src="${esc(order.boatImage || './images/boat2.jpg')}" alt="${esc(order.boatName || "Boat")}">
                </div>
                <div class="project-content">
                    <div class="project-header">
                        <div>
                            <h2 class="project-title">${esc(order.boatName || "Boat")}</h2>
                            <p class="project-subtitle">${esc(order.orderPhase || "Cancelled")}</p>
                        </div>
                        <span class="project-status rejected"><i class="fa-solid fa-ban"></i> Cancelled</span>
                    </div>

                    <div class="project-details">
                        <div class="detail-box">
                            <span>Cancelled on</span>
                            <h4>${order.cancelApprovedAt ? esc(new Date(order.cancelApprovedAt).toLocaleDateString()) : "N/A"}</h4>
                        </div>
                        ${order.cancelReason ? `
                        <div class="detail-box" style="flex:2;">
                            <span>Reason</span>
                            <h4 style="font-weight:400;font-size:13px;">${esc(order.cancelReason)}</h4>
                        </div>` : ''}
                        <div class="detail-box">
                            <span>Boat Price</span>
                            <h4>₱${price.toLocaleString()}</h4>
                        </div>
                    </div>

                    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:14px;padding:16px;margin-top:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                            <h4 style="margin:0;font-size:14px;color:#dc2626;">
                                <i class="fa-solid fa-triangle-exclamation"></i> Order Cancelled
                            </h4>
                            ${fee > 0 ? `
                            <span style="background:#dc2626;color:white;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;">
                                Fee: ₱${fee.toLocaleString()}
                            </span>` : `
                            <span style="background:#16a34a;color:white;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;">
                                No Fee
                            </span>`}
                        </div>

                        ${fee > 0 ? `
                        <div style="background:white;border-radius:10px;padding:12px;margin-top:8px;">
                            <p style="font-size:13px;color:#991b1b;margin:0 0 6px 0;">
                                <strong>Project Stage:</strong> ${esc(penalty.label)} (${order.progress || 0}%)
                            </p>
                            <p style="font-size:13px;color:#991b1b;margin:0 0 6px 0;">
                                <strong>Penalty Rate:</strong> ${esc(penalty.penalty)}
                            </p>
                            <p style="font-size:13px;color:#991b1b;margin:0 0 6px 0;">
                                <strong>Cancellation Fee:</strong> ₱${fee.toLocaleString()}
                            </p>
                            <p style="font-size:13px;color:#991b1b;margin:0 0 6px 0;">
                                <strong>Previous Status:</strong> ${esc(order.previousStatus || "N/A")}
                            </p>
                            ${materials.length > 0 ? `
                            <div style="margin-top:10px;padding-top:10px;border-top:1px solid #fca5a5;">
                                <p style="font-size:13px;color:#991b1b;margin:0 0 6px 0;font-weight:600;">
                                    <i class="fa-solid fa-list"></i> Materials Already Allocated:
                                </p>
                                <ul style="margin:0;padding-left:18px;font-size:13px;color:#7f1d1d;">
                                    ${materials.map(m => `<li>${esc(m)}</li>`).join('')}
                                </ul>
                            </div>` : ''}
                        </div>` : ''}

                        <p style="font-size:13px;color:#991b1b;margin:0;padding-top:10px;border-top:${fee > 0 ? '1px solid #fca5a5' : 'none'};margin-top:${fee > 0 ? '10px' : '0'};">
                            <i class="fa-solid fa-clock"></i> <strong>Cancelled on:</strong> ${order.cancelApprovedAt ? esc(new Date(order.cancelApprovedAt).toLocaleString()) : "N/A"}
                        </p>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        }
    }

    /* =============================================
       TAB RENDERING
    ============================================= */

    function renderProjectTabButtons(idx) {
        return `
        <div class="project-tabs">
            <button class="project-tab-btn active" data-tab="progress">Progress</button>
            <button class="project-tab-btn" data-tab="activity">Activity</button>
            <button class="project-tab-btn" data-tab="materials">Materials</button>
            <button class="project-tab-btn" data-tab="documents">Documents</button>
            <button class="project-tab-btn" data-tab="photos">Photos</button>
            <button class="project-tab-btn" data-tab="timeline">Timeline</button>
            <button class="project-tab-btn" data-tab="delivery">Delivery</button>
            <button class="project-tab-btn" data-tab="payments">Payments</button>
        </div>`;
    }

    function renderMilestonesSection(order, idx) {
        const milestones = getMilestones(order);
        const progress = Number(order.progress) || 0;
        if (milestones.length === 0) return '<div style="padding:16px;color:#94a3b8;font-size:13px;">No milestone data available.</div>';

        const limit = 3;
        const hasMore = milestones.length > limit;

        function renderMilestoneItem(m) {
            return `
                <div class="milestone-item ${m.completed ? 'completed' : ''}">
                    <div class="milestone-header" onclick="
                        const hist = this.parentElement.querySelector('.milestone-history-wrap');
                        const tog = this.querySelector('.milestone-toggle');
                        if(hist) { hist.classList.toggle('open'); }
                        if(tog) { tog.classList.toggle('open'); }
                    ">
                        <div class="milestone-check">
                            ${m.completed ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle"></i>'}
                        </div>
                        <div class="milestone-info">
                            <strong>${m.label}</strong>
                            <span>${m.percentage}% — ${m.completed ? (m.completedDate ? new Date(m.completedDate).toLocaleDateString() : 'Completed') : 'In Progress'}</span>
                        </div>
                        ${m.history && m.history.length > 0 ? '<i class="fa-solid fa-chevron-down milestone-toggle"></i>' : ''}
                    </div>
                    ${m.history && m.history.length > 0 ? `
                    <div class="milestone-history-wrap">
                        <div class="milestone-history">
                            ${m.history.map(h => `<p><i class="fa-solid fa-clock"></i> ${h}</p>`).join('')}
                        </div>
                    </div>` : ''}
                </div>`;
        }

        const visible = milestones.slice(0, limit).map(renderMilestoneItem).join('');
        const extra = milestones.slice(limit).map(renderMilestoneItem).join('');

        return `
        <div class="tab-panel active" id="tab-progress-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-flag-checkered"></i> Project Milestones</h4>
            <div class="milestone-list">
                ${visible}
                ${hasMore ? `
                <div class="milestone-more-wrap" id="milestoneMore-${idx}">
                    ${extra}
                </div>
                <button class="milestone-see-all" onclick="
                    const wrap = document.getElementById('milestoneMore-${idx}');
                    const btn = this;
                    wrap.classList.toggle('open');
                    btn.textContent = wrap.classList.contains('open') ? 'Show Less' : 'See All (${milestones.length - limit} more)';
                ">See All (${milestones.length - limit} more)</button>` : ''}
            </div>
            ${progress >= 100 ? `
            <div style="margin-top:16px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;">
                <h4 style="font-size:14px;color:#16a34a;margin-bottom:4px;"><i class="fa-solid fa-trophy"></i> Project Complete</h4>
                <p style="font-size:13px;color:#166534;">${order.projectCompletedDate ? 'Completed on ' + new Date(order.projectCompletedDate).toLocaleDateString() : 'Marked as completed'}</p>
            </div>` : `
            <div style="margin-top:16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
                <h4 style="font-size:14px;color:#1d4ed8;margin-bottom:4px;">Next Milestone</h4>
                <p style="font-size:13px;color:#475569;">${milestones.find(m => !m.completed)?.label || 'All milestones completed'}</p>
            </div>`}
            <div id="customerTasksContainer-${idx}" style="margin-top:16px;"></div>
            ${renderBudgetSection(order, idx)}
        </div>`;
    }

    function renderBudgetSection(order, idx) {
        if (order.status !== "Approved" && order.status !== "Completed") return "";
        const bi = order.budgetInfo && typeof order.budgetInfo === "object" ? order.budgetInfo : {};
        const total = bi.totalBudget || 0;
        if (!total) return "";
        const expenses = bi.expenses || [];
        const spent = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        const pct = Math.min(100, (spent / total) * 100);
        const remaining = Math.max(0, total - spent);
        const statusColor = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e";
        const categoryColors = {
            Materials: "#dbeafe", Labor: "#fef3c7", Equipment: "#e0e7ff",
            Transport: "#fce7f3", Permits: "#d1fae5", Other: "#f1f5f9"
        };
        const categoryTextColors = {
            Materials: "#1e40af", Labor: "#92400e", Equipment: "#3730a3",
            Transport: "#9d174d", Permits: "#065f46", Other: "#475569"
        };
        return `
        <div style="margin-top:16px;padding:16px;background:white;border:1px solid #e2e8f0;border-radius:14px;">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:12px;"><i class="fa-solid fa-coins"></i> Budget Overview</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px;">
                    <span style="font-size:11px;color:#64748b;">Budget</span>
                    <strong style="display:block;font-size:16px;color:#16a34a;">₱${total.toLocaleString()}</strong>
                </div>
                <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px;">
                    <span style="font-size:11px;color:#64748b;">Spent</span>
                    <strong style="display:block;font-size:16px;color:#dc2626;">₱${spent.toLocaleString()}</strong>
                </div>
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px;">
                    <span style="font-size:11px;color:#64748b;">Remaining</span>
                    <strong style="display:block;font-size:16px;color:${statusColor};">₱${remaining.toLocaleString()}</strong>
                </div>
            </div>
            <div style="height:10px;background:#e2e8f0;border-radius:5px;overflow:hidden;margin-bottom:12px;">
                <div style="height:100%;width:${pct}%;background:${statusColor};border-radius:5px;transition:width 0.3s;"></div>
            </div>
            ${expenses.length > 0 ? `
            <h5 style="font-size:13px;font-weight:600;margin-bottom:8px;color:#475569;">Expenses</h5>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;">
                ${expenses.map(e => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                    <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:50px;background:${categoryColors[e.category] || '#f1f5f9'};color:${categoryTextColors[e.category] || '#475569'};white-space:nowrap;">${e.category || 'Other'}</span>
                    <div style="flex:1;min-width:0;">
                        <strong style="font-size:12px;color:#0f172a;display:block;">${esc(e.description || '')}</strong>
                        <span style="font-size:11px;color:#64748b;">${e.date ? new Date(e.date).toLocaleDateString() : ''}</span>
                    </div>
                    <strong style="font-size:13px;color:#dc2626;">-₱${(parseFloat(e.amount) || 0).toLocaleString()}</strong>
                </div>`).join('')}
            </div>` : '<p style="font-size:13px;color:#94a3b8;text-align:center;padding:8px;">No expenses recorded yet.</p>'}
        </div>`;
    }

    function renderActivityLogSection(order, idx) {
        const log = getActivityLog(order);
        const defaultActivities = getBoatActivities(order.boatName);
        return `
        <div class="tab-panel" id="tab-activity-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-clock-rotate-left"></i> Manufacturing Activity Log</h4>
            ${log.length > 0 ? `
            <div class="activity-feed">
                ${log.slice().reverse().map(e => {
                    const statusClass = e.status === "completed" ? "activity-dot-completed" : e.status === "in-progress" ? "activity-dot-current" : "activity-dot-pending";
                    const statusLabel = e.status === "completed" ? "Completed" : e.status === "in-progress" ? "In Progress" : "Pending";
                    return `
                    <div class="activity-entry">
                        <div class="activity-dot ${statusClass}"></div>
                        <div class="activity-content">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                                <strong>${esc(e.title)}</strong>
                                <span class="activity-status-badge ${e.status === "completed" ? "status-completed" : e.status === "in-progress" ? "status-in-progress" : "status-pending"}">${esc(statusLabel)}</span>
                            </div>
                            <p>${esc(e.description || '')}</p>
                            <span><i class="fa-solid fa-building"></i> ${esc(e.role || '')} ${e.date ? esc('• ' + new Date(e.date).toLocaleString()) : ''}</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>` : defaultActivities.length > 0 ? `
            <div style="padding:16px;color:#94a3b8;font-size:13px;">Activity tracking will begin once the project progresses.</div>
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;">
                ${defaultActivities.map(a => `
                <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                    <i class="fa-regular fa-circle" style="color:#94a3b8;font-size:14px;"></i>
                    <div style="flex:1;">
                        <strong style="font-size:13px;color:#64748b;">${esc(a.title)}</strong>
                        <span style="display:block;font-size:11px;color:#94a3b8;">${esc(a.department)}</span>
                    </div>
                </div>`).join('')}
            </div>` : '<div style="padding:16px;color:#94a3b8;font-size:13px;">No activity entries yet.</div>'}
        </div>`;
    }

    function renderMaterialsSection(order, idx) {
        const mats = getBoatMaterials(order.boatName);
        const specs = getBoatSpecs(order.boatName);
        if (!mats) return '<div class="tab-panel" id="tab-materials-' + idx + '" style="display:none;"><p style="padding:16px;color:#94a3b8;">No materials information available.</p></div>';

        function specRow(label, val) {
            return val ? `<div class="spec-item"><span>${label}</span><strong>${val}</strong></div>` : '';
        }

        return `
        <div class="tab-panel" id="tab-materials-${idx}">
            <div style="margin-bottom:16px;">
                <h4 style="font-size:15px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-ship"></i> Vessel Specifications</h4>
                <div class="specs-grid">
                    ${specRow("Length Overall", specs.length)}
                    ${specRow("Width", specs.width)}
                    ${specRow("Breadth", specs.breadth)}
                    ${specRow("Depth", specs.depth)}
                    ${specRow("Height", specs.height)}
                    ${specRow("Capacity", specs.passengerCapacity)}
                    ${specRow("Engine Power", specs.enginePower)}
                    ${specRow("Max Speed", specs.maxSpeed)}
                </div>
            </div>

            <div style="margin-bottom:16px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
                <h4 style="font-size:15px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-list-check"></i> Key Materials</h4>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                    ${getBoatSimpleMaterials(order.boatName).materials.map(m => `
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:white;border:1px solid #dbeafe;border-radius:50px;font-size:13px;font-weight:500;color:#1d4ed8;">
                        <i class="fa-solid fa-check-circle" style="color:#22c55e;font-size:12px;"></i> ${m}
                    </span>`).join('')}
                </div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:white;border:1px solid #e2e8f0;border-radius:10px;">
                    <i class="fa-solid fa-engine" style="color:#2563eb;font-size:16px;"></i>
                    <div>
                        <strong style="font-size:13px;">Engine Configuration</strong>
                        <p style="font-size:12px;color:#64748b;margin-top:2px;">${getBoatSimpleMaterials(order.boatName).engine}</p>
                    </div>
                </div>
            </div>

            <h4 style="font-size:15px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-cubes"></i> Hull & Structure</h4>
            <div class="specs-grid">
                <div class="spec-item"><span>Hull Material</span><strong>${mats.hullMaterial}</strong></div>
                <div class="spec-item"><span>Core Material</span><strong>${mats.coreMaterial || 'N/A'}</strong></div>
                <div class="spec-item"><span>Stringers</span><strong>${mats.structuralStringers || 'N/A'}</strong></div>
                <div class="spec-item"><span>Bulkheads</span><strong>${mats.bulkheadMaterial || 'N/A'}</strong></div>
                <div class="spec-item"><span>Deck Material</span><strong>${mats.deckMaterial || 'N/A'}</strong></div>
                <div class="spec-item"><span>Resin Type</span><strong>${mats.resinType || 'N/A'}</strong></div>
                <div class="spec-item"><span>Exterior Finish</span><strong>${mats.exteriorFinish || 'N/A'}</strong></div>
                <div class="spec-item"><span>Anti-Fouling</span><strong>${mats.antiFouling || 'N/A'}</strong></div>
            </div>
            <h4 style="font-size:14px;font-weight:700;margin:16px 0 10px;"><i class="fa-solid fa-engine"></i> Engine & Propulsion</h4>
            <div class="specs-grid">
                <div class="spec-item"><span>Engine Type</span><strong>${mats.engineType}</strong></div>
                <div class="spec-item"><span>Engine Make</span><strong>${mats.engineMake || 'N/A'}</strong></div>
                <div class="spec-item"><span>Engine Power</span><strong>${mats.enginePower}</strong></div>
                <div class="spec-item"><span>Propeller</span><strong>${mats.propeller || 'N/A'}</strong></div>
                <div class="spec-item"><span>Shaft Material</span><strong>${mats.shaftMaterial || 'N/A'}</strong></div>
            </div>
            <h4 style="font-size:14px;font-weight:700;margin:16px 0 10px;"><i class="fa-solid fa-bolt"></i> Electrical & Fuel</h4>
            <div class="specs-grid">
                <div class="spec-item"><span>Electrical System</span><strong>${mats.electricalSystem || 'N/A'}</strong></div>
                <div class="spec-item"><span>Batteries</span><strong>${mats.batteries || 'N/A'}</strong></div>
                <div class="spec-item"><span>Panel Type</span><strong>${mats.panelType || 'N/A'}</strong></div>
                <div class="spec-item"><span>Fuel Tank</span><strong>${mats.fuelTank || 'N/A'}</strong></div>
                <div class="spec-item"><span>Fuel Lines</span><strong>${mats.fuelLines || 'N/A'}</strong></div>
            </div>
            <h4 style="font-size:14px;font-weight:700;margin:16px 0 10px;"><i class="fa-solid fa-water"></i> Plumbing & Hardware</h4>
            <div class="specs-grid">
                <div class="spec-item"><span>Water System</span><strong>${mats.waterSystem || 'N/A'}</strong></div>
                <div class="spec-item"><span>Holding Tank</span><strong>${mats.holdingTank || 'N/A'}</strong></div>
                <div class="spec-item"><span>Windows</span><strong>${mats.windows || 'N/A'}</strong></div>
                <div class="spec-item"><span>Rubrail</span><strong>${mats.rubrail || 'N/A'}</strong></div>
                <div class="spec-item"><span>Cleats & Hardware</span><strong>${mats.cleatsAndHardware || 'N/A'}</strong></div>
            </div>
            ${mats.winchSystem ? `
            <h4 style="font-size:14px;font-weight:700;margin:16px 0 10px;"><i class="fa-solid fa-gear"></i> Parasail Equipment</h4>
            <div class="specs-grid">
                <div class="spec-item"><span>Winch System</span><strong>${mats.winchSystem}</strong></div>
                <div class="spec-item"><span>Winch Rope</span><strong>${mats.winchRope || 'N/A'}</strong></div>
                <div class="spec-item"><span>Roller</span><strong>${mats.roller || 'N/A'}</strong></div>
                <div class="spec-item"><span>Safety Rails</span><strong>${mats.safetyRails || 'N/A'}</strong></div>
                <div class="spec-item"><span>Tow Pylon</span><strong>${mats.towPylon || 'N/A'}</strong></div>
                <div class="spec-item"><span>Parasail Canopy</span><strong>${mats.parasailCanopy || 'N/A'}</strong></div>
                <div class="spec-item"><span>Passenger Harnesses</span><strong>${mats.passengerHarnesses || 'N/A'}</strong></div>
                <div class="spec-item"><span>Communication System</span><strong>${mats.communicationSystem || 'N/A'}</strong></div>
            </div>` : ''}
            <h4 style="font-size:14px;font-weight:700;margin:16px 0 10px;"><i class="fa-solid fa-shield"></i> Safety Equipment</h4>
            <div class="specs-grid">
                <div class="spec-item"><span>Life Rafts</span><strong>${mats.lifeRafts || 'N/A'}</strong></div>
                <div class="spec-item"><span>Life Jackets</span><strong>${mats.lifeJackets || 'N/A'}</strong></div>
                <div class="spec-item"><span>Fire System</span><strong>${mats.fireSystem || 'N/A'}</strong></div>
            </div>
        </div>`;
    }

    function renderDocumentsSection(order, idx) {
        const docs = order.documents && Array.isArray(order.documents) ? order.documents : [];
        return `
        <div class="tab-panel" id="tab-documents-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-folder-open"></i> Project Documents</h4>
            ${docs.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${docs.map(d => `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;color:#295dff;font-size:18px;">
                        <i class="fa-solid fa-file-lines"></i>
                    </div>
                    <div style="flex:1;">
                        <strong style="font-size:14px;color:#0f172a;display:block;">${esc(d.name)}</strong>
                        <div style="display:flex;gap:8px;font-size:12px;color:#64748b;margin-top:2px;">
                            <span>${esc(d.category)}</span>
                            ${d.uploadedAt ? `<span>• ${new Date(d.uploadedAt).toLocaleDateString()}</span>` : ''}
                            ${d.fileSize ? `<span>• ${Math.round(d.fileSize / 1024)} KB</span>` : ''}
                        </div>
                    </div>
                    <a href="${d.fileUrl}" target="_blank" style="padding:8px 14px;background:#295dff;color:white;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;white-space:nowrap;">
                        <i class="fa-solid fa-eye"></i> View
                    </a>
                </div>
                `).join('')}
            </div>` : `
            <div style="padding:32px;text-align:center;color:#94a3b8;">
                <i class="fa-solid fa-folder-open" style="font-size:40px;display:block;margin-bottom:12px;color:#dbeafe;"></i>
                <p style="font-size:14px;">No documents uploaded yet.</p>
                <p style="font-size:13px;">Project documents such as contracts, permits, and drawings will appear here once uploaded by the admin.</p>
            </div>`}
        </div>`;
    }

    function renderPhotosSection(order, idx) {
        const photos = order.progressPhotos && Array.isArray(order.progressPhotos) ? order.progressPhotos : [];
        return `
        <div class="tab-panel" id="tab-photos-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-images"></i> Build Progress Photos</h4>
            ${photos.length > 0 ? `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
                ${photos.map(p => `
                <div style="border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;background:white;">
                    <img src="${p.fileUrl}" alt="${p.caption}" style="width:100%;height:130px;object-fit:cover;display:block;cursor:pointer;" onclick="window.open('${p.fileUrl}','_blank')">
                    <div style="padding:6px 8px;font-size:12px;color:#64748b;">
                        <strong style="display:block;color:#0f172a;font-size:12px;">${esc(p.caption || 'Progress update')}</strong>
                        ${p.uploadedAt ? `<span style="font-size:11px;">${new Date(p.uploadedAt).toLocaleDateString()}</span>` : ''}
                    </div>
                </div>`).join('')}
            </div>` : `
            <div style="padding:32px;text-align:center;color:#94a3b8;">
                <i class="fa-solid fa-camera" style="font-size:40px;display:block;margin-bottom:12px;color:#dbeafe;"></i>
                <p style="font-size:14px;">No progress photos yet.</p>
                <p style="font-size:13px;">Build progress photos will appear here once uploaded by the admin.</p>
            </div>`}
        </div>`;
    }

    function renderTimelineSection(order, idx) {
        const progress = Number(order.progress) || 0;
        const timeline = getEstimatedTimeline(order);
        const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A";
        const completionDate = getEstimatedCompletionDate(order);
        const durationStr = getProjectDuration(order);

        return `
        <div class="tab-panel" id="tab-timeline-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-calendar-days"></i> Project Timeline</h4>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <i class="fa-solid fa-calendar-plus" style="color:#2563eb;font-size:14px;"></i>
                        <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Order Date</span>
                    </div>
                    <strong style="display:block;font-size:15px;color:#1d4ed8;">${esc(orderDate)}</strong>
                </div>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <i class="fa-solid fa-calendar-check" style="color:#16a34a;font-size:14px;"></i>
                        <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Estimated Completion</span>
                    </div>
                    <strong style="display:block;font-size:15px;color:#16a34a;">${esc(completionDate)}</strong>
                    <span style="font-size:12px;color:#16a34a;">${esc(durationStr)} from order date</span>
                </div>
            </div>

            <p style="font-size:13px;color:#64748b;margin-bottom:14px;">Total Estimated Duration: Approximately ${esc(durationStr)}</p>
            <div style="position:relative;padding-left:20px;">
                <div style="position:absolute;left:15px;top:8px;bottom:8px;width:2px;background:linear-gradient(to bottom,#295aa8,#1f3760);border-radius:2px;"></div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${timeline.map(t => {
                        const active = progress >= t.percentage;
                        const current = !active && progress >= (t.startPct || 0);
                        return `
                        <div style="display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:12px;background:${active ? '#f0fdf4' : current ? '#eff6ff' : '#f8fafc'};border:1px solid ${active ? '#bbf7d0' : current ? '#bfdbfe' : '#e2e8f0'};position:relative;">
                            <div style="width:24px;height:24px;min-width:24px;border-radius:50%;background:${active ? '#22c55e' : current ? '#2563eb' : '#e2e8f0'};border:3px solid white;box-shadow:0 0 0 2px ${active ? '#22c55e' : current ? '#2563eb' : '#e2e8f0'};display:flex;align-items:center;justify-content:center;color:white;font-size:11px;flex-shrink:0;">
                                ${active ? '<i class="fa-solid fa-check"></i>' : ''}
                            </div>
                            <div style="flex:1;">
                                <strong style="font-size:14px;color:${active ? '#16a34a' : '#0f172a'};display:block;">${esc(t.phase)}</strong>
                                <span style="font-size:12px;color:#64748b;">${esc(t.duration)}</span>
                            </div>
                            ${current ? '<span style="font-size:11px;font-weight:600;color:#2563eb;background:#dbeafe;padding:4px 10px;border-radius:50px;"><i class="fa-solid fa-play"></i> Current</span>' : ''}
                            ${active ? '<span style="font-size:11px;font-weight:600;color:#16a34a;background:#dcfce7;padding:4px 10px;border-radius:50px;"><i class="fa-solid fa-check"></i> Done</span>' : ''}
                        </div>`;
                    }).join('')}
                </div>
            </div>
            <div style="margin-top:14px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;">
                <h4 style="font-size:14px;color:#16a34a;margin-bottom:4px;"><i class="fa-solid fa-ship"></i> Expected Delivery</h4>
                <p style="font-size:13px;color:#166534;"><strong>${esc(completionDate)}</strong></p>
                <p style="font-size:12px;color:#16a34a;margin-top:4px;">Based on order date (${esc(orderDate)}) + ${esc(durationStr)} build duration</p>
            </div>
        </div>`;
    }

    function renderDeliverySection(order, idx) {
        const progress = Number(order.progress) || 0;
        const delivery = getDeliveryInfo(order);
        const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A";

        if (progress < 70 && order.status !== "Completed") {
            return `<div class="tab-panel" id="tab-delivery-${idx}" style="display:none;">
                <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-truck"></i> Delivery Tracking</h4>
                <div style="padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <i class="fa-solid fa-clock" style="color:#f59e0b;font-size:16px;"></i>
                        <span style="font-size:13px;color:#92400e;font-weight:600;">Delivery info available at 70% completion</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
                        <div style="padding:10px;background:white;border:1px solid #e2e8f0;border-radius:10px;">
                            <span style="font-size:11px;color:#64748b;display:block;">Estimated Delivery</span>
                            <strong style="font-size:14px;color:#2563eb;">${esc(delivery.expectedDate)}</strong>
                            <span style="font-size:11px;color:#64748b;">Based on ${esc(getProjectDuration(order))} build + lead time</span>
                        </div>
                        <div style="padding:10px;background:white;border:1px solid #e2e8f0;border-radius:10px;">
                            <span style="font-size:11px;color:#64748b;display:block;">Current Progress</span>
                            <strong style="font-size:14px;color:#2563eb;">${progress}%</strong>
                            <span style="font-size:11px;color:#64748b;">Construction in progress</span>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        const deliveryStatuses = [
            { label: "Preparing for Delivery", value: "Preparing for Delivery", icon: "fa-boxes", color: "#f59e0b", active: false },
            { label: "Ready for Delivery", value: "Ready for Delivery", icon: "fa-check-circle", color: "#2563eb", active: false },
            { label: "In Transit", value: "In Transit", icon: "fa-truck-fast", color: "#8b5cf6", active: false },
            { label: "Delivered", value: "Delivered", icon: "fa-circle-check", color: "#22c55e", active: false }
        ];

        const currentStatus = delivery.deliveryStatus || "Preparing for Delivery";
        let foundCurrent = false;
        deliveryStatuses.forEach(s => {
            if (!foundCurrent && s.value === currentStatus) {
                s.active = true;
                foundCurrent = true;
            } else if (foundCurrent) {
                s.active = false;
            } else {
                s.active = true;
            }
        });
        if (currentStatus === "Delivered") {
            deliveryStatuses.forEach(s => s.active = true);
        }

        return `
        <div class="tab-panel" id="tab-delivery-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-truck"></i> Delivery Tracking</h4>

            <div class="delivery-status-track">
                ${deliveryStatuses.map((s, i) => `
                <div class="delivery-step ${s.active ? 'step-active' : ''} ${currentStatus === s.value ? 'step-current' : ''} ${i < deliveryStatuses.length - 1 ? 'step-connector' : ''}">
                    <div class="delivery-step-icon">
                        <i class="fa-solid ${s.icon}"></i>
                    </div>
                    <span class="delivery-step-label">${s.label}</span>
                </div>`).join('')}
            </div>

            <div class="specs-grid" style="margin-top:16px;">
                <div class="spec-item"><span>Delivery Status</span><strong style="color:${currentStatus === 'Delivered' ? '#16a34a' : '#2563eb'};">${currentStatus}</strong></div>
                <div class="spec-item"><span>Build Time</span><strong>${getProjectDuration(order)}</strong></div>
                <div class="spec-item"><span>Estimated Delivery Date</span><strong style="color:#2563eb;">${delivery.expectedDate}</strong></div>
                <div class="spec-item"><span>Committed Delivery Date</span><strong>${delivery.committedDate || 'Not yet set'}</strong></div>
                <div class="spec-item"><span>Actual Delivery Date</span><strong>${delivery.actualDate || 'Pending'}</strong></div>
                <div class="spec-item"><span>Order Date</span><strong>${esc(orderDate)}</strong></div>
                <div class="spec-item"><span>Delivery Location</span><strong>${delivery.deliveryLocation || 'To be confirmed'}</strong></div>
                <div class="spec-item"><span>Contact Person</span><strong>${delivery.contactPerson || 'To be assigned'}</strong></div>
                <div class="spec-item"><span>Sea Trial Results</span><strong>${delivery.seaTrialResults}</strong></div>
                <div class="spec-item"><span>Delivery Confirmed</span><strong>${delivery.deliveryConfirmed ? 'Yes' : 'Pending'}</strong></div>
            </div>

            ${delivery.delayDays > 0 ? `
            <div style="margin-top:16px;padding:16px;background:#fef2f2;border:1px solid #fca5a5;border-radius:14px;">
                <h4 style="font-size:14px;font-weight:700;color:#991b1b;margin-bottom:8px;"><i class="fa-solid fa-exclamation-triangle"></i> Delivery Delay Notice</h4>
                <p style="font-size:13px;color:#7f1d1d;margin-bottom:10px;">We apologize for the delay. Your boat was delivered <strong>${delivery.delayDays} day(s)</strong> past the committed date.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                    <div style="padding:10px;background:#fff;border:1px solid #fecaca;border-radius:10px;">
                        <span style="font-size:11px;color:#991b1b;display:block;">Committed Date</span>
                        <strong style="font-size:13px;color:#991b1b;">${delivery.committedDate || 'N/A'}</strong>
                    </div>
                    <div style="padding:10px;background:#fff;border:1px solid #fecaca;border-radius:10px;">
                        <span style="font-size:11px;color:#991b1b;display:block;">Actual Delivery Date</span>
                        <strong style="font-size:13px;color:#991b1b;">${delivery.actualDate || 'N/A'}</strong>
                    </div>
                </div>
                ${delivery.delayPenalty > 0 ? `
                <div style="padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
                    <h5 style="font-size:13px;font-weight:700;color:#15803d;margin-bottom:4px;"><i class="fa-solid fa-check-circle"></i> Compensation Applied</h5>
                    <p style="font-size:13px;color:#166534;">A discount of <strong>${delivery.delayPenaltyPercent}% (₱${Number(delivery.delayPenalty).toLocaleString()})</strong> has been applied to your order as compensation for the delay.</p>
                </div>` : ''}
                ${delivery.delayReason ? `<p style="font-size:12px;color:#991b1b;margin-top:8px;"><strong>Reason:</strong> ${delivery.delayReason}</p>` : ''}
            </div>` : ''}

            <div style="margin-top:16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
                <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-circle-info"></i> Delivery Details</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
                    <div><span style="color:#64748b;">Standard Lead Time:</span><br><strong>${delivery.standardLeadTime}</strong></div>
                    <div><span style="color:#64748b;">Delivery Method:</span><br><strong>${delivery.deliveryMethod}</strong></div>
                    <div><span style="color:#64748b;">Sea Trial Duration:</span><br><strong>${delivery.seaTrialDuration}</strong></div>
                    <div><span style="color:#64748b;">Prep & Training:</span><br><strong>${delivery.preparationDays} / ${delivery.trainingDays}</strong></div>
                </div>
            </div>

            <div style="margin-top:14px;">
                <div class="progress-top"><span>Delivery Preparation</span><span>${delivery.deliveryProgress}%</span></div>
                <div class="modern-progress"><div class="modern-progress-fill" style="width:${delivery.deliveryProgress}%;background:linear-gradient(90deg,#f59e0b,#d97706);"></div></div>
            </div>

            ${delivery.deliveryConfirmed ? `
            <div style="margin-top:14px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;">
                <h4 style="font-size:14px;color:#16a34a;"><i class="fa-solid fa-check-circle"></i> Delivered Successfully</h4>
                <p style="font-size:13px;color:#166534;margin-top:4px;">Your boat has been delivered. Thank you for choosing Infinite Work Boat!</p>
            </div>` : ''}
        </div>`;
    }

    async function renderPaymentProgressSection(order, idx) {
        const isPendingSigning = order.status === "Pending Signing" || order.status === "Pending" || order.status === "Schedule Rejected";
        const canViewPayments = order.status === "Approved" || order.status === "Completed";

        if (!canViewPayments) {
            const pendingMsg = isPendingSigning
                ? "Payment information will be available once the admin approves your contract signing schedule."
                : "Payment details will appear once your order is approved.";
            return `
            <div class="tab-panel" id="tab-payments-${idx}">
                <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-credit-card"></i> Payment Progress</h4>
                <div style="padding:24px;text-align:center;color:#94a3b8;">
                    <i class="fa-solid fa-lock" style="font-size:40px;display:block;margin-bottom:12px;color:#dbeafe;"></i>
                    <p style="font-size:14px;">Payment information is locked.</p>
                    <p style="font-size:13px;">${esc(pendingMsg)}</p>
                </div>
            </div>`;
        }

        let amountPaid = getAmountPaidForOrder(order.orderId) || 0;
        try {
            const { data: payments } = await handleDbError(
                supabase
                    .from("dashboard_payments")
                    .select("amount")
                    .eq("orderId", order.orderId)
                    .eq("status", "Approved"),
                "Fetching approved payments for tab"
            );
            if (payments && payments.length > 0) {
                amountPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                cacheAmountPaid(order.orderId, amountPaid);
            } else {
                amountPaid = 0;
                cacheAmountPaid(order.orderId, 0);
            }
        } catch (e) {
            console.error("Payment tab fetch error:", e);
        }

        const phases = getPaymentPhases(order);
        const isGovernment = order.paymentMethod && order.paymentMethod.toLowerCase().includes("government");
        const totalPrice = parseFloat(String(order.boatPrice).replace(/[^0-9.]/g, "")) || 0;
        const isFullyPaid = totalPrice > 0 && amountPaid >= totalPrice;
        const remaining = Math.max(0, totalPrice - amountPaid);

        const unpaidPhases = phases.filter(p => !p.completed && !p.current);
        const currentPhase = phases.find(p => p.current);
        const upcomingHTML = order.paymentMethod !== "Full Payment" && !isFullyPaid ? `
            <div style="margin-top:14px;padding:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;">
                <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;color:#1d4ed8;"><i class="fa-solid fa-clock"></i> Upcoming Payments</h4>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${currentPhase ? `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
                        <div>
                            <span style="font-size:12px;color:#92400e;font-weight:600;"><i class="fa-solid fa-circle-exclamation"></i> Current Due</span>
                            <strong style="display:block;font-size:14px;color:#0f172a;margin-top:2px;">${esc(currentPhase.label)}</strong>
                        </div>
                        <strong style="font-size:16px;color:#d97706;">₱${Math.round(totalPrice * currentPhase.percentage / 100).toLocaleString()}</strong>
                    </div>` : ''}
                    ${unpaidPhases.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                        <div>
                            <span style="font-size:12px;color:#64748b;font-weight:500;">Upcoming</span>
                            <strong style="display:block;font-size:13px;color:#334155;margin-top:1px;">${esc(p.label)}</strong>
                        </div>
                        <strong style="font-size:14px;color:#2563eb;">₱${Math.round(totalPrice * p.percentage / 100).toLocaleString()}</strong>
                    </div>`).join('')}
                </div>
            </div>` : '';

        return `
        <div class="tab-panel" id="tab-payments-${idx}">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:14px;"><i class="fa-solid fa-credit-card"></i> Payment Progress</h4>

            <div class="payment-summary-cards" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px;">
                    <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Total Contract</span>
                    <strong style="display:block;font-size:20px;color:#1d4ed8;margin-top:4px;">₱${totalPrice.toLocaleString()}</strong>
                </div>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;">
                    <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Amount Paid</span>
                    <strong style="display:block;font-size:20px;color:#16a34a;margin-top:4px;">₱${amountPaid.toLocaleString()}</strong>
                </div>
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px;">
                    <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Remaining</span>
                    <strong style="display:block;font-size:20px;color:#ea580c;margin-top:4px;">₱${remaining.toLocaleString()}</strong>
                </div>
            </div>

            ${isGovernment ? `
            <div style="padding:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:14px;margin-bottom:14px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                    <i class="fa-solid fa-building-columns" style="color:#d97706;font-size:18px;"></i>
                    <h4 style="font-size:14px;color:#92400e;">Government Project Payment Terms</h4>
                </div>
                <p style="font-size:13px;color:#78350f;margin-top:4px;">Payment due upon delivery per contractual agreement. Government procurement regulations apply. Please refer to your approved contract for specific payment schedule and terms.</p>
            </div>` : `
            <div style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;margin-bottom:14px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                    <i class="fa-solid fa-building" style="color:#16a34a;font-size:18px;"></i>
                    <h4 style="font-size:14px;color:#16a34a;">Private Company Payment Terms</h4>
                </div>
                ${order.paymentMethod !== "Full Payment" ? `
                <div style="margin-top:8px;padding:10px;background:white;border-radius:10px;border:1px solid #e2e8f0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:12px;color:#64748b;">Estimated Monthly Payment</span>
                        <strong style="font-size:16px;color:#059669;">₱${Math.round(totalPrice / Math.max(parseBuildDurationToMonths(getProjectDuration(order)), 1)).toLocaleString()}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:2px;">
                        <span>Total: ₱${totalPrice.toLocaleString()}</span>
                        <span>Duration: ${getProjectDuration(order)}</span>
                    </div>
                </div>` : ''}
                <div style="display:grid;grid-template-columns:1fr ${order.paymentMethod !== 'Full Payment' ? '1fr 1fr' : ''};gap:8px;margin-top:8px;">
                    ${(() => {
                        const pp = order.paymentMethod === "Full Payment" ? FULL_PAYMENT_PHASES : PAYMENT_PHASES;
                        return pp.map(p => `
                        <div style="background:white;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0;">
                            <strong style="font-size:18px;color:#2563eb;display:block;">${p.percentage}%</strong>
                            <span style="font-size:11px;color:#64748b;">${p.label.replace(/\d+%\s?/, '')}<br>₱${Math.round(totalPrice * p.percentage / 100).toLocaleString()}</span>
                        </div>`).join('');
                    })()}
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${phases.map(p => `
                <div class="phase-item ${p.completed ? 'completed' : p.current ? 'current' : ''}">
                    <div class="phase-indicator">
                        ${p.completed ? '<i class="fa-solid fa-circle-check"></i>' : p.current ? '<i class="fa-solid fa-circle"></i>' : '<i class="fa-regular fa-circle"></i>'}
                    </div>
                    <div style="flex:1;">
                        <strong>${p.label}</strong>
                        <p style="font-size:12px;color:#64748b;">${p.description}</p>
                    </div>
                    <span style="font-size:13px;font-weight:700;color:${p.completed ? '#16a34a' : '#94a3b8'};">${p.completed ? 'Paid' : p.current ? 'Current' : 'Pending'}</span>
                </div>`).join('')}
            </div>`}
            ${upcomingHTML}
            ${order.paymentHistory && order.paymentHistory.length > 0 ? `
            <h4 style="font-size:14px;font-weight:700;margin:16px 0 10px;"><i class="fa-solid fa-clock-rotate-left"></i> Payment History</h4>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${order.paymentHistory.map(h => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:13px;">
                    <span>${esc(h.phase)}</span>
                    <span style="font-weight:600;">₱${Number(h.amount || 0).toLocaleString()}</span>
                    <span style="color:#64748b;">${h.date ? esc(new Date(h.date).toLocaleDateString()) : ''}</span>
                    <span class="payment-history-status" style="color:${h.status === 'Approved' ? '#16a34a' : '#f59e0b'};">${esc(h.status || 'Pending')}</span>
                </div>`).join('')}
            </div>` : '<div style="padding:16px;color:#94a3b8;font-size:13px;text-align:center;">No payment history available yet.</div>'}
            ${isFullyPaid ? `
            <div style="margin-top:14px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;">
                <h4 style="font-size:14px;color:#16a34a;"><i class="fa-solid fa-check-circle"></i> All Payments Settled</h4>
                <p style="font-size:13px;color:#166534;margin-top:4px;">This project has been fully paid. Thank you for your business!</p>
            </div>` : ''}
        </div>`;
    }

    function renderWarrantySection(order) {
        if (order.status !== "Completed") return '';
        const warranty = order.warrantyInfo || { warrantyPeriod: "1 Year", coverage: "Hull and structural defects" };
        return `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:14px;margin-bottom:16px;">
            <h4 style="font-size:14px;color:#16a34a;margin-bottom:6px;"><i class="fa-solid fa-shield-halved"></i> Warranty Information</h4>
            <p style="font-size:13px;color:#166534;"><strong>Warranty Period:</strong> ${warranty.warrantyPeriod}</p>
            <p style="font-size:13px;color:#166534;"><strong>Coverage:</strong> ${warranty.coverage}</p>
        </div>`;
    }

    async function switchProjectTab(card, tabName, idx) {
        const tabBtns = card.querySelectorAll(".project-tab-btn");
        tabBtns.forEach(b => b.classList.remove("active"));
        const activeBtn = card.querySelector(`.project-tab-btn[data-tab="${tabName}"]`);
        if (activeBtn) activeBtn.classList.add("active");

        const tabContent = card.querySelector(".project-tab-content");
        if (!tabContent) return;

        const orderId = card.dataset.orderId;
        const allOrders = getOrders();
        const order = allOrders.find(o => (o.orderId || (o.boatName + o.createdAt)) === orderId);
        if (!order) return;

        const renderers = {
            progress: renderMilestonesSection,
            activity: renderActivityLogSection,
            materials: renderMaterialsSection,
            documents: renderDocumentsSection,
            photos: renderPhotosSection,
            timeline: renderTimelineSection,
            delivery: renderDeliverySection,
            payments: renderPaymentProgressSection
        };

        const fn = renderers[tabName] || renderers.progress;
        try {
            tabContent.innerHTML = await fn(order, idx);
            if (tabName === "progress" && order.orderId) {
                loadCustomerTasks(order.orderId, idx);
            }
        } catch (e) {
            console.error("[Render Error] Tab:", e);
            tabContent.innerHTML = '<div class="tab-panel"><p style="padding:20px;color:#ef4444;">Failed to load content.</p></div>';
        }
    }

    async function loadCustomerTasks(orderId, idx) {
        const container = document.getElementById("customerTasksContainer-" + idx);
        if (!container) return;
        const { data: tasks } = await handleDbError(
            supabase.from("project_tasks").select("*").eq("orderId", orderId).order("createdAt", { ascending: false }),
            "Loading customer tasks"
        );
        if (!tasks || tasks.length === 0) {
            container.innerHTML = "";
            return;
        }
        const statuses = ["Not Started", "In Progress", "Done"];
        const counts = {};
        statuses.forEach(s => counts[s] = tasks.filter(t => t.status === s).length);

        container.innerHTML = `
            <h4 style="font-size:15px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-list-check"></i> Project Tasks</h4>
            <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                ${statuses.map(s => `
                    <span style="padding:3px 10px;border-radius:50px;font-size:11px;font-weight:600;background:${s === 'Done' ? '#dcfce7' : s === 'In Progress' ? '#dbeafe' : '#f1f5f9'};color:${s === 'Done' ? '#16a34a' : s === 'In Progress' ? '#2563eb' : '#64748b'};">
                        ${s}: ${counts[s] || 0}
                    </span>
                `).join('')}
                <span style="padding:3px 10px;border-radius:50px;font-size:11px;font-weight:600;background:#f1f5f9;color:#0f172a;">Total: ${tasks.length}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${tasks.map(t => {
                    const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done";
                    const priorityColors = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };
                    return `
                        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:${t.status === 'Done' ? '#f0fdf4' : '#f8fafc'};border:1px solid ${t.status === 'Done' ? '#bbf7d0' : isOverdue ? '#fca5a5' : '#e2e8f0'};">
                            <div style="width:16px;height:16px;border-radius:50%;background:${t.status === 'Done' ? '#22c55e' : '#e2e8f0'};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;flex-shrink:0;">
                                ${t.status === 'Done' ? '<i class="fa-solid fa-check"></i>' : ''}
                            </div>
                            <div style="flex:1;min-width:0;">
                                <strong style="font-size:12px;color:${t.status === 'Done' ? '#16a34a' : '#0f172a'};display:block;">${esc(t.title)}</strong>
                                <div style="display:flex;gap:6px;margin-top:2px;flex-wrap:wrap;">
                                    ${t.assignedTo ? `<span style="font-size:10px;color:#64748b;"><i class="fa-solid fa-user"></i> ${esc(t.assignedTo)}</span>` : ''}
                                    <span style="font-size:10px;font-weight:600;color:${priorityColors[t.priority] || '#94a3b8'};">${esc(t.priority)}</span>
                                    ${t.dueDate ? `<span style="font-size:10px;color:${isOverdue ? '#dc2626' : '#64748b'};"><i class="fa-solid fa-calendar"></i> ${esc(new Date(t.dueDate).toLocaleDateString())}</span>` : ''}
                                </div>
                            </div>
                            <span style="font-size:10px;padding:2px 8px;border-radius:50px;background:${t.status === 'Done' ? '#dcfce7' : t.status === 'In Progress' ? '#dbeafe' : '#f1f5f9'};color:${t.status === 'Done' ? '#16a34a' : t.status === 'In Progress' ? '#2563eb' : '#64748b'};
                            ">${esc(t.status)}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderWorkersPreview(workers, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const shown = workers.slice(0, 3);
        shown.forEach(w => {
            const pill = document.createElement("span");
            const sClass = getSpecialtyClass(w.role);
            pill.className = `worker-pill ${sClass}`;
            pill.innerHTML = `<i class="fa-solid ${getSpecialtyIcon(w.role)}"></i>${esc(w.name)} <span class="pill-role">${esc(w.role)}</span>`;
            container.appendChild(pill);
        });

        if (workers.length > 3) {
            const more = document.createElement("span");
            more.className = "worker-pill";
            more.textContent = `+${workers.length - 3} more`;
            container.appendChild(more);
        }
    }

    function openWorkersModal(workers, projectName) {
        const modal = document.getElementById("workersModal");
        document.getElementById("modalProjectName").textContent = projectName;
        const list = document.getElementById("workersFullList");
        list.innerHTML = "";

        const isEngineer = w => (w.role || "").toLowerCase() === "engineer";
        const engineers = workers.filter(isEngineer);
        const others = workers.filter(w => !isEngineer(w));

        const sorted = [...engineers, ...others];
        sorted.forEach(w => {
            const item = document.createElement("div");
            const sClass = getSpecialtyClass(w.role);
            item.className = `worker-item ${sClass}`;
            item.innerHTML = `
                <div class="worker-avatar">
                    <i class="fa-solid ${getSpecialtyIcon(w.role)}"></i>
                </div>
                <div class="worker-info">
                    <h5>${esc(w.name)} ${isEngineer(w) ? '<span class="engineer-badge">ENGINEER</span>' : ""}</h5>
                    <span class="worker-role-label">${esc(w.role)}</span>
                </div>
            `;
            list.appendChild(item);
        });

        modal.classList.add("show");
    }

    function showReminder(order) {
        const price = parseFloat(String(order.boatPrice).replace(/[^0-9.]/g, "")) || 0;
        const paid = getAmountPaidForOrder(order.orderId) || 0;
        const remaining = Math.max(0, price - paid);
        const progress = Number(order.progress) || 0;
        const completionDate = getEstimatedCompletionDate(order);

        const existing = document.querySelector(".reminder-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.className = "reminder-toast";
        toast.style.cssText = "position:fixed;bottom:30px;right:30px;background:white;border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,0.15);border:1px solid #e2e8f0;z-index:9999;max-width:380px;animation:slideUp 0.3s ease;";
        toast.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                <div style="width:40px;height:40px;border-radius:12px;background:#fef3c7;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-bell" style="color:#d97706;font-size:18px;"></i>
                </div>
                <div>
                    <h4 style="font-size:15px;font-weight:700;color:#0f172a;">Payment Reminder</h4>
                    <p style="font-size:12px;color:#64748b;">${esc(order.boatName || "Boat")}</p>
                </div>
                <button onclick="this.closest('.reminder-toast').remove()" style="margin-left:auto;background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;">&times;</button>
            </div>
            <div style="margin-bottom:12px;">
                ${remaining > 0 ? `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
                    <span style="font-size:13px;color:#64748b;">Remaining Balance</span>
                    <strong style="font-size:13px;color:#ea580c;">₱${remaining.toLocaleString()}</strong>
                </div>` : `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
                    <span style="font-size:13px;color:#64748b;">Payment Status</span>
                    <strong style="font-size:13px;color:#16a34a;">Fully Paid</strong>
                </div>`}
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
                    <span style="font-size:13px;color:#64748b;">Build Progress</span>
                    <strong style="font-size:13px;color:#2563eb;">${progress}%</strong>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;">
                    <span style="font-size:13px;color:#64748b;">Est. Completion</span>
                    <strong style="font-size:13px;color:#059669;">${completionDate}</strong>
                </div>
            </div>
            ${remaining > 0 ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:12px;">
                <p style="font-size:12px;color:#92400e;"><i class="fa-solid fa-circle-exclamation"></i> You have an outstanding balance of <strong>₱${remaining.toLocaleString()}</strong>. Please settle to avoid any delays.</p>
            </div>
            <button onclick="this.closest('.reminder-toast').remove();document.querySelector('[data-order-id=\\'${esc(order.orderId)}\\']')?.click();" style="width:100%;padding:10px;background:#2563eb;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">Proceed to Payment</button>` : `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;">
                <p style="font-size:12px;color:#166534;"><i class="fa-solid fa-check-circle"></i> All payments settled. No outstanding balance.</p>
            </div>`}
        `;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 10000);
    }

    function openOrderSummary(order, workers) {
        const modal = document.getElementById("orderSummaryModal");
        document.getElementById("orderSummaryTitle").textContent = "Order Summary - " + esc(order.boatName || "Boat");
        document.getElementById("orderSummarySubtitle").textContent = "Order ID: " + esc(order.orderId) + " | Status: " + esc(order.status || "Pending");

        const price = parseFloat(String(order.boatPrice).replace(/[^0-9.]/g, "")) || 0;
        const paid = getAmountPaidForOrder(order.orderId) || 0;
        const content = document.getElementById("orderSummaryContent");
        content.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
                <div>
                    <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;color:#1e293b;">Boat Details</h4>
                    <div class="specs-grid">
                        <div class="spec-item"><span>Boat Name</span><strong>${esc(order.boatName || "N/A")}</strong></div>
                        <div class="spec-item"><span>Boat Type</span><strong>${esc(order.boatType || order.buildType || "N/A")}</strong></div>
                        <div class="spec-item"><span>Build Type</span><strong>${esc(order.buildType || "Standard")}</strong></div>
                        <div class="spec-item"><span>Build Time</span><strong>${esc(order.buildTime || "N/A")}</strong></div>
                        <div class="spec-item"><span>Estimated Completion</span><strong>${getEstimatedCompletionDate(order)}</strong></div>
                        <div class="spec-item"><span>Payment Method</span><strong>${esc(order.paymentMethod || "N/A")}</strong></div>
                    </div>
                </div>
                <div>
                    <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;color:#1e293b;">Order Status</h4>
                    <div class="specs-grid">
                        <div class="spec-item"><span>Order Date</span><strong>${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "N/A"}</strong></div>
                        <div class="spec-item"><span>Current Status</span><strong style="color:#2563eb;">${esc(order.status || "Pending")}</strong></div>
                        <div class="spec-item"><span>Progress</span><strong>${order.progress || 0}%</strong></div>
                        <div class="spec-item"><span>Build Stage</span><strong>${esc(getProjectStage(order.progress))}</strong></div>
                    </div>
                </div>
            </div>
            <div style="margin-top:16px;">
                <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;color:#1e293b;">Financial Summary</h4>
                <div class="specs-grid" style="grid-template-columns:1fr 1fr 1fr;">
                    <div class="spec-item"><span>Total Price</span><strong>₱${price.toLocaleString()}</strong></div>
                    <div class="spec-item"><span>Amount Paid</span><strong style="color:#16a34a;">₱${paid.toLocaleString()}</strong></div>
                    <div class="spec-item"><span>Remaining Balance</span><strong style="color:#ea580c;">₱${Math.max(0, price - paid).toLocaleString()}</strong></div>
                </div>
                ${order.paymentMethod !== "Full Payment" ? `
                <div style="margin-top:10px;padding:12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
                    <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:#475569;">Payment Breakdown</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                        ${PAYMENT_PHASES.map(p => `
                        <div style="text-align:center;padding:8px;background:white;border-radius:8px;border:1px solid #e2e8f0;">
                            <strong style="font-size:15px;color:#2563eb;">₱${Math.round(price * p.percentage / 100).toLocaleString()}</strong>
                            <div style="font-size:11px;color:#64748b;">${p.label}</div>
                        </div>`).join('')}
                    </div>
                    <div style="margin-top:8px;padding:8px;background:#eff6ff;border-radius:8px;text-align:center;">
                        <span style="font-size:12px;color:#64748b;">Estimated Monthly: </span>
                        <strong style="font-size:15px;color:#059669;">₱${Math.round(price / Math.max(parseBuildDurationToMonths(getProjectDuration(order)), 1)).toLocaleString()}/mo</strong>
                    </div>
                </div>` : ''}
            </div>
            ${workers && workers.length > 0 ? `
            <div style="margin-top:16px;">
                <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;color:#1e293b;">Assigned Workers (${workers.length})</h4>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${workers.map(w => `
                    <span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;font-size:12px;">
                        <i class="fa-solid ${getSpecialtyIcon(w.role)}" style="color:#64748b;"></i>
                        ${esc(w.name)} <span style="color:#94a3b8;">(${esc(w.role)})</span>
                    </span>`).join('')}
                </div>
            </div>` : ''}
            <div class="boat-actions" style="margin-top:20px;">
                <button class="view-specs" onclick="document.getElementById('orderSummaryModal').classList.remove('show')">Close</button>
            </div>
        `;

        modal.classList.add("show");
    }

    async function getWorkersForOrder(order) {
        if (!order.orderId) return [];
        try {
            const apiBase = window.location.port === "3000" ? window.location.origin : "http://localhost:3000";
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            const res = await fetch(apiBase + "/api/workers/" + order.orderId, {
                headers: token ? { Authorization: "Bearer " + token } : {}
            });
            if (!res.ok) return [];
            return await res.json();
        } catch (e) {
            console.error("Failed to load workers:", e);
            return [];
        }
    }

    function getBuildStage(progress, status, order) {
        if (status === "Rejected") return "Order Rejected";
        if (status === "Under Review") return "Under Engineering Review";
        if (status === "Revision Required") return "Revision Requested";
        if (status === "Pending Signing") return "Awaiting Contract Signing";
        if (status === "Pending") return "Pending Admin Review";
        if (progress === 0) {
            if (order && order.paymentMethod === "Full Payment") return "Waiting For Full Payment";
            return "Waiting For Downpayment";
        }
        if (progress >= 100) return "Boat Completed - Ready for Delivery";
        if (progress >= 70) return "Painting & Finishing";
        if (progress >= 45) return "Interior Installation";
        if (progress >= 25) return "Engine Assembly";
        return "Hull Construction";
    }

    function getBuildWeeks(progress) {
        if (progress === 0) return "No Build Process Yet";
        if (progress >= 100) return "Build Complete";
        const weeks = Math.round((progress / 100) * 40);
        return `Week ${weeks} of Construction`;
    }

    function getStatusClass(status) {
        if (status === "Approved" || status === "Completed") return "approved";
        if (status === "Rejected") return "rejected";
        return "pending";
    }


    const modal = document.getElementById("workersModal");
    document.getElementById("modalClose").addEventListener("click", () => {
        modal.classList.remove("show");
    });
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("show");
    });

    const modalEscHandler = (e) => {
        if (e.key === "Escape") modal.classList.remove("show");
    };
    document.addEventListener("keydown", modalEscHandler);


    /* =============================================
       NOTIFICATION SYSTEM
    ============================================= */

    function safeName(val) {
        return (val && val !== "undefined" && val.trim()) ? val.trim() : "Your Boat";
    }

    function generateNotifications() {
        const notifications = [];
        const checkpoint = JSON.parse(localStorage.getItem("notifCheckpoint") || "{}");
        const allOrders = getOrders();
        const myOrders = allOrders.filter(o =>
            o.customerEmail === customerEmail || o.customerName === customerName
        );

        myOrders.forEach(order => {
            const orderId = order.orderId || order.boatName + order.createdAt;
            const prev = checkpoint[orderId];
            if (!prev) {
                checkpoint[orderId] = { status: order.status, progress: order.progress };
                return;
            }
            if (prev.status !== order.status) {
                const msg = `${safeName(order.boatName)}: Status changed to "${order.status}"`;
                notifications.push({ msg, time: new Date().toISOString(), orderId });
                checkpoint[orderId] = { status: order.status, progress: order.progress };
            } else if (prev.progress !== order.progress) {
                const msg = `${safeName(order.boatName)}: Progress updated to ${order.progress}%`;
                notifications.push({ msg, time: new Date().toISOString(), orderId });
                checkpoint[orderId] = { status: order.status, progress: order.progress };
            }
        });

        localStorage.setItem("notifCheckpoint", JSON.stringify(checkpoint));

        const existing = JSON.parse(localStorage.getItem("boatNotifications") || "[]");
        const merged = [...notifications, ...existing].slice(0, 20);
        localStorage.setItem("boatNotifications", JSON.stringify(merged));

        return merged;
    }

    function renderNotifications(notifications) {
        const badge = document.getElementById("notifBadge");
        const list = document.getElementById("notifList");
        if (!badge || !list) return;

        const lastViewed = parseInt(localStorage.getItem("notifLastViewed") || "0");
        const hasNew = notifications.some(n => new Date(n.time).getTime() > lastViewed);

        if (notifications.length === 0) {
            badge.style.display = "none";
            list.innerHTML = '<div class="notif-empty">No notifications</div>';
            return;
        }

        if (hasNew) {
            badge.style.display = "inline";
            badge.textContent = notifications.length;
        } else {
            badge.style.display = "none";
        }

        list.innerHTML = notifications.map(n => `
            <div class="notif-item" data-order-id="${esc(n.orderId)}" style="cursor:pointer;">
                <div class="notif-dot"></div>
                <div class="notif-content">
                    <p>${esc(n.msg)}</p>
                    <span>${esc(new Date(n.time).toLocaleDateString())}</span>
                </div>
            </div>
        `).join("");

        list.querySelectorAll(".notif-item").forEach(item => {
            item.addEventListener("click", () => {
                const oid = item.dataset.orderId;
                dropdown.classList.remove("show");
                if (oid) {
                    localStorage.setItem("scrollToOrderId", oid);
                }
                window.location.hash = "projectsSection";
                location.reload();
            });
        });
    }

    const notifications = generateNotifications();
    renderNotifications(notifications);

    const scrollToId = localStorage.getItem("scrollToOrderId");
    if (scrollToId) {
        localStorage.removeItem("scrollToOrderId");
        setTimeout(() => {
            document.getElementById("projectsSection")?.scrollIntoView({ behavior: "smooth" });
            const cards = document.querySelectorAll("#myOrdersGrid .project-card");
            cards.forEach(card => {
                const title = card.querySelector(".project-title")?.textContent || "";
                const status = card.querySelector(".project-status")?.textContent || "";
                const allOrders = getOrders();
                const match = allOrders.find(o => o.orderId === scrollToId);
                if (match && title.includes(match.boatName)) {
                    card.style.boxShadow = "0 0 0 3px #2563eb, 0 8px 30px rgba(37,99,235,.25)";
                    card.style.transition = "box-shadow .3s";
                    card.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => {
                        card.style.boxShadow = "";
                    }, 3000);
                }
            });
        }, 300);
    }

    const bell = document.getElementById("notificationBell");
    const dropdown = document.getElementById("notifDropdown");
    if (bell && dropdown) {
        bell.addEventListener("click", (e) => {
            e.preventDefault();
            localStorage.setItem("notifLastViewed", Date.now());
            const badge = document.getElementById("notifBadge");
            if (badge) badge.style.display = "none";
            dropdown.classList.toggle("show");
        });
        document.addEventListener("click", (e) => {
            if (!bell.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.remove("show");
            }
        });
    }

    document.getElementById("markAllRead")?.addEventListener("click", () => {
        localStorage.removeItem("boatNotifications");
        renderNotifications([]);
        const badge = document.getElementById("notifBadge");
        if (badge) { badge.style.display = "none"; badge.textContent = "0"; }
        dropdown.classList.remove("show");
    });

    /* =============================================
       PROJECT FILTERS
    ============================================= */

    async function applyFilter(filter, orders) {
        currentFilter = filter;
        const emptyState = document.getElementById("emptyState");
        const ordersGrid = document.getElementById("myOrdersGrid");
        const cancelledSection = document.getElementById("cancelledSection");

        if (filter === "all") {
            if (cancelledSection) cancelledSection.style.display = cancelledOrders.length > 0 ? "block" : "none";
            if (orders.length === 0) {
                emptyState.style.display = "block";
                emptyState.innerHTML = emptyStateHTML;
                ordersGrid.style.display = "none";
            } else {
                emptyState.style.display = "none";
                ordersGrid.style.display = "grid";
                await renderProjects(orders);
            }
            return;
        }

        if (cancelledSection) cancelledSection.style.display = "none";

        let filtered;
        if (filter === "active") {
            filtered = orders.filter(o => o.status !== "Completed" && o.status !== "Rejected" && o.status !== "Cancelled");
        } else if (filter === "completed") {
            filtered = orders.filter(o => o.status === "Completed");
        } else if (filter === "pending-signing") {
            filtered = orders.filter(o => o.status === "Pending Signing");
        } else if (filter === "cancelled") {
            filtered = cancelledOrders;
        } else {
            filtered = orders;
        }

        if (filtered.length === 0) {
            emptyState.style.display = "block";
            ordersGrid.style.display = "none";
            emptyState.innerHTML = `
                <div class="empty-icon"><i class="fa-solid fa-search"></i></div>
                <h3>No ${filter} projects</h3>
                <p>No projects match this filter.</p>
            `;
        } else {
            emptyState.style.display = "none";
            ordersGrid.style.display = "grid";
            await renderProjects(filtered);
        }
    }

    document.querySelectorAll(".proj-filter").forEach(btn => {
        btn.addEventListener("click", async () => {
            document.querySelectorAll(".proj-filter").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            await applyFilter(btn.dataset.filter, myOrders);
        });
    });

    /* =============================================
       PAYMENT BUTTON
    ============================================= */

    document.getElementById("myOrdersGrid")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".payment-btn");
        if (!btn || btn.disabled) return;
        if (btn.dataset.action === "resume-cancel") return;
        if (btn.dataset.action === "resubmit-schedule") return;
        if (btn.dataset.action === "revise-design") return;
        const orderId = btn.dataset.orderId;
        const allOrders = getOrders();
        const order = allOrders.find(o => o.orderId === orderId);
        if (order) {
            localStorage.setItem("currentOrder", JSON.stringify(order));
        }
        window.location.href = "payment.html";
    });

    document.getElementById("myOrdersGrid")?.addEventListener("click", (e) => {
        const cancelBtn = e.target.closest("[data-action='cancel']");
        if (cancelBtn) {
            const orderId = cancelBtn.dataset.orderId;
            if (orderId) window.openCancelModal(orderId);
            return;
        }
        const resumeBtn = e.target.closest("[data-action='resume-cancel']");
        if (resumeBtn) {
            const orderId = resumeBtn.dataset.orderId;
            if (orderId) window.resumeCancelPayment(orderId);
            return;
        }
    });

    /* =============================================
       CANCEL ORDER
    ============================================= */

    function getCancelMaterials(progress) {
        if (progress >= 21) return ["Steering system components", "Fuel tank assembly", "Seating frames & upholstery", "Wiring harness & electronics"];
        if (progress >= 16) return ["Engine components (ordered)", "Wiring harness & connectors", "Propeller shaft assembly"];
        if (progress >= 11) return ["Hull frame materials (steel/aluminum)", "Fiberglass sheets & resin", "Keel & rib components"];
        return ["Blueprint & design plans", "Engineering review documents", "Material quote sheets"];
    }

    window.openCancelModal = function(orderId) {
        const allOrders = getOrders();
        const order = allOrders.find(o => o.orderId === orderId);
        if (!order) return;

        const modal = document.getElementById("cancelModal");
        const penaltyTable = document.getElementById("cancelPenaltyTable");
        const simple = document.getElementById("cancelSimple");
        const consequences = document.getElementById("cancelConsequences");

        const progress = order.progress || 0;
        const penalty = getPenaltyInfo(progress);
        const price = parseFloat(String(order.boatPrice).replace(/[^0-9.]/g, "")) || 0;
        const isApproved = order.status === "Approved";
        let fee = isApproved ? Math.round(price * penalty.feeRate) : 0;

        window._cancelOrderId = orderId;
        window._cancelFee = fee;
        window._penaltyStage = penalty;

        modal.classList.add("show");
        penaltyTable.style.display = "block";
        simple.style.display = "none";
        consequences.style.display = "none";

        const stageRow = document.querySelector("#cancelPenaltyTable tbody tr:nth-child(" + (PENALTY_STAGES.indexOf(penalty) + 1) + ")");
        if (stageRow) {
            stageRow.style.background = "#fef2f2";
            stageRow.style.fontWeight = "700";
        }

        const proceedBtn = document.getElementById("cancelPenaltyProceedBtn");
        const costDiv = document.getElementById("penaltyYourCost");
        costDiv.style.display = "block";

        if (!isApproved) {
            proceedBtn.disabled = false;
            proceedBtn.style.opacity = "";
            proceedBtn.style.cursor = "";
            stageRow.style.background = "#f0fdf4";
            stageRow.style.fontWeight = "700";
            costDiv.innerHTML = `
                <h4 style="color:#16a34a;font-size:14px;margin-bottom:4px;"><i class="fa-solid fa-check-circle"></i> No Cancellation Fee</h4>
                <p style="font-size:13px;color:#166534;">Your order is not yet approved. No cancellation fee applies. You may proceed to cancel.</p>
            `;
        } else if (penalty.feeRate >= 1) {
            proceedBtn.disabled = true;
            proceedBtn.style.opacity = "0.5";
            proceedBtn.style.cursor = "not-allowed";
            costDiv.innerHTML = `
                <h4 style="color:#dc2626;font-size:14px;margin-bottom:4px;"><i class="fa-solid fa-triangle-exclamation"></i> Your Project Stage: ${penalty.label}</h4>
                <p style="font-size:13px;color:#991b1b;">Your project is in the <strong>${penalty.label}</strong> stage (${progress}% complete). This stage is <strong>Non-Refundable</strong>. The order cannot be cancelled at this stage.</p>
            `;
        } else {
            proceedBtn.disabled = false;
            proceedBtn.style.opacity = "";
            proceedBtn.style.cursor = "";
            costDiv.innerHTML = `
                <h4 style="color:#dc2626;font-size:14px;margin-bottom:4px;"><i class="fa-solid fa-triangle-exclamation"></i> Your Estimated Cancellation Cost</h4>
                <p style="font-size:13px;color:#991b1b;">Project Stage: <strong>${penalty.label}</strong> (${progress}% complete)</p>
                <p style="font-size:13px;color:#991b1b;">Penalty: <strong>${penalty.penalty}</strong> — Estimated Fee: <strong>₱${fee.toLocaleString()}</strong></p>
            `;
        }
    };

    function confirmPenaltyProceed() {
        const penaltyTable = document.getElementById("cancelPenaltyTable");
        const simple = document.getElementById("cancelSimple");
        const consequences = document.getElementById("cancelConsequences");

        penaltyTable.style.display = "none";

        if (window._cancelFee > 0) {
            consequences.style.display = "block";
            simple.style.display = "none";

            const allOrders = getOrders();
            const order = allOrders.find(o => o.orderId === window._cancelOrderId);
            if (!order) return;

            document.getElementById("cancelConsequenceStatus").textContent = "Current Status: " + order.status + " — " + (order.progress || 0) + "% complete";
            document.getElementById("cancelStageDisplay").textContent = getProjectStage(order.progress || 0);
            document.getElementById("cancelProgressDisplay").textContent = (order.progress || 0) + "%";

            document.getElementById("cancelFeeDisplay").textContent = "₱" + window._cancelFee.toLocaleString();
            document.getElementById("cancelFeeInline").textContent = "₱" + window._cancelFee.toLocaleString();

            const boatDetailBox = document.getElementById("cancelBoatDetails") || (function() {
                const existing = document.getElementById("cancelConsequences").querySelector(".cancel-boat-details");
                if (existing) return existing;
                const box = document.createElement("div");
                box.className = "cancel-boat-details";
                box.style.cssText = "background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin:12px 0;";
                box.innerHTML = `
                    <h4 style="font-size:13px;color:#475569;margin-bottom:8px;"><i class="fa-solid fa-ship"></i> BOAT DETAILS</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
                        <div><span style="color:#64748b;">Boat Name:</span> <strong id="cancelBoatName">${esc(order.boatName || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Price:</span> <strong id="cancelBoatPrice">${esc(order.boatPrice || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Build Type:</span> <strong id="cancelBuildType">${esc(order.buildType === "custom" ? "Custom Build" : "Standard Build")}</strong></div>
                        <div><span style="color:#64748b;">Payment Method:</span> <strong id="cancelPaymentMethod">${esc(order.paymentMethod || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Build Time:</span> <strong id="cancelBuildTime">${esc(order.buildTime || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Order Date:</span> <strong id="cancelOrderDate">${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "N/A"}</strong></div>
                    </div>
                `;
                const ref = document.getElementById("cancelConsequences").querySelector(".cancel-status");
                if (ref && ref.nextElementSibling) {
                    ref.parentNode.insertBefore(box, ref.nextElementSibling);
                }
                return box;
            })();

            const mats = getCancelMaterials(order.progress || 0);
            document.getElementById("cancelMaterialsList").innerHTML = mats.map(m => "<li>" + m + "</li>").join("");

            if (window._cancelOrderId) {
                document.getElementById("cancelReasonConsequence").value = "";
                document.getElementById("cancelSignatureConsequence").value = "";
                document.getElementById("cancelUnderstandCheck").checked = false;
            }
        } else {
            consequences.style.display = "none";
            simple.style.display = "block";

            const allOrders = getOrders();
            const order = allOrders.find(o => o.orderId === window._cancelOrderId);
            if (!order) return;

            document.getElementById("cancelCurrentStatus").textContent = "Current Status: " + order.status;
            const boatDetailBoxSimple = document.getElementById("cancelSimple").querySelector(".cancel-boat-details");
            if (!boatDetailBoxSimple) {
                const box2 = document.createElement("div");
                box2.className = "cancel-boat-details";
                box2.style.cssText = "background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin:12px 0;";
                box2.innerHTML = `
                    <h4 style="font-size:13px;color:#475569;margin-bottom:8px;"><i class="fa-solid fa-ship"></i> BOAT DETAILS</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
                        <div><span style="color:#64748b;">Boat Name:</span> <strong>${esc(order.boatName || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Price:</span> <strong>${esc(order.boatPrice || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Build Type:</span> <strong>${order.buildType === "custom" ? "Custom Build" : "Standard Build"}</strong></div>
                        <div><span style="color:#64748b;">Payment Method:</span> <strong>${esc(order.paymentMethod || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Build Time:</span> <strong>${esc(order.buildTime || "N/A")}</strong></div>
                        <div><span style="color:#64748b;">Order Date:</span> <strong>${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "N/A"}</strong></div>
                    </div>
                `;
                const statusEl = document.getElementById("cancelCurrentStatus");
                if (statusEl && statusEl.nextElementSibling) {
                    statusEl.parentNode.insertBefore(box2, statusEl.nextElementSibling);
                }
            }
            if (window._cancelOrderId) {
                document.getElementById("cancelReason").value = "";
                document.getElementById("cancelSignature").value = "";
            }
        }
    }

    window.resumeCancelPayment = function(orderId) {
        const allOrders = getOrders();
        const order = allOrders.find(o => o.orderId === orderId);
        if (!order) { alert("Order not found."); return; }
        localStorage.setItem("currentOrder", JSON.stringify({
            ...order,
            cancelFee: order.cancelFee,
            cancelReason: order.cancelReason,
            cancelSignature: order.cancelSignature
        }));
        localStorage.setItem("cancelPaymentMode", "true");
        window.location.href = "payment.html?mode=cancelFee";
    };

    async function submitCancelRequest() {
        const fee = window._cancelFee || 0;
        const allOrders = getOrders();
        const order = allOrders.find(o => o.orderId === window._cancelOrderId);
        if (!order) return;

        let reason, signature;
        if (fee > 0) {
            reason = document.getElementById("cancelReasonConsequence").value.trim();
            signature = document.getElementById("cancelSignatureConsequence").value.trim();
            if (!document.getElementById("cancelUnderstandCheck").checked) {
                alert("Please check the box to confirm you understand the cancellation consequences.");
                return;
            }
        } else {
            reason = document.getElementById("cancelReason").value.trim();
            signature = document.getElementById("cancelSignature").value.trim();
        }

        if (!reason) { alert("Please provide a reason for cancellation."); return; }
        if (!signature) { alert("Please type your full name as signature."); return; }
        const registeredName = localStorage.getItem("customerName");
        if (registeredName && signature !== registeredName) {
            alert('Signature must match your registered name: "' + registeredName + '".');
            return;
        }

        const match = allOrders.find(o => o.orderId === order.orderId);
        if (!match) return;

        const now = new Date().toISOString();
        const cancelMaterials = getCancelMaterials(order.progress || 0);

        match.cancelReason = reason;
        match.cancelSignature = signature;
        match.cancelFee = fee;
        match.cancelMaterials = cancelMaterials;
        match.previousStatus = order.status;
        match.cancelRequestedAt = now;

        if (fee === 0) {
            match.status = "Cancelled";
            match.orderPhase = "Cancelled";
            match.progress = 0;
            match.cancelApprovedAt = now;

            setOrders(allOrders);
            const { error } = await handleDbError(
                supabase
                    .from("boat_orders")
                    .update({
                        status: "Cancelled",
                        orderPhase: "Cancelled",
                        progress: 0,
                        cancelReason: reason,
                        cancelSignature: signature,
                        cancelFee: 0,
                        cancelMaterials: cancelMaterials,
                        previousStatus: order.status,
                        cancelRequestedAt: now,
                        cancelApprovedAt: now
                    })
                    .eq("orderId", match.orderId),
                "Auto-cancelling order"
            );
            if (error) return;

            sendEmailNotification({ type: "cancellation_requested", recipient: customerEmail, data: match });
            sendEmailNotification({ type: "cancellation_requested", recipient: "infinityboatsystem@gmail.com", data: match });

            const updatedUserOrders = allOrders.filter(o =>
                o.customerEmail === customerEmail || o.customerName === customerName
            );
            const updatedMyOrders = updatedUserOrders.filter(o => o.status !== "Cancelled");
            cancelledOrders = updatedUserOrders.filter(o => o.status === "Cancelled");

            document.getElementById("cancelModal").classList.remove("show");
            myOrders.length = 0;
            myOrders.push(...updatedMyOrders);
            await updateStats(myOrders, cancelledOrders.length, cancelledOrders);
            await applyFilter("all", myOrders);
            renderCancelledOrders(cancelledOrders);

            alert("Your order has been cancelled.");
        } else {
            match.status = "Cancellation Requested";

            setOrders(allOrders);
            await handleDbError(
                supabase
                    .from("boat_orders")
                    .update({
                        status: "Cancellation Requested",
                        cancelReason: reason,
                        cancelSignature: signature,
                        cancelFee: fee,
                        cancelMaterials: cancelMaterials,
                        previousStatus: order.status,
                        cancelRequestedAt: now
                    })
                    .eq("orderId", match.orderId),
                "Submitting cancellation request"
            );

            sendEmailNotification({ type: "cancellation_requested", recipient: "infinityboatsystem@gmail.com", data: match });
            document.getElementById("cancelModal").classList.remove("show");
            localStorage.setItem("currentOrder", JSON.stringify(match));
            localStorage.setItem("cancelPaymentMode", "true");
            window.location.href = "payment.html?mode=cancelFee";
        }
    }

    document.getElementById("cancelCloseBtn")?.addEventListener("click", () => document.getElementById("cancelModal").classList.remove("show"));
    document.getElementById("cancelConsequenceCloseBtn")?.addEventListener("click", () => document.getElementById("cancelModal").classList.remove("show"));
    document.getElementById("cancelModalClose")?.addEventListener("click", () => document.getElementById("cancelModal").classList.remove("show"));
    document.getElementById("cancelPenaltyBackBtn")?.addEventListener("click", () => document.getElementById("cancelModal").classList.remove("show"));
    document.getElementById("cancelPenaltyProceedBtn")?.addEventListener("click", confirmPenaltyProceed);
    document.getElementById("cancelModal")?.addEventListener("click", (e) => {
        if (e.target === document.getElementById("cancelModal")) {
            document.getElementById("cancelModal").classList.remove("show");
        }
    });
    document.getElementById("cancelSubmitBtn")?.addEventListener("click", submitCancelRequest);
    document.getElementById("cancelConsequenceSubmitBtn")?.addEventListener("click", submitCancelRequest);

    window.finalizeCustomOrder = function(orderId) {
        const allOrders = getOrders();
        const order = allOrders.find(o => o.orderId === orderId);
        if (order) {
            localStorage.setItem("finalizingCustomOrder", JSON.stringify(order));
            window.location.href = "order.html?mode=finalize";
        }
    };

    window.orderBoat = function(name, price, buildTime, downpayment, image) {
        const boatData = { name, price, buildTime, downpayment, image };
        localStorage.setItem("selectedBoat", JSON.stringify(boatData));
        window.location.href = "order.html";
    }

    function shiftBoatImg(imgId, key, dir) {
        const gallery = boatGalleries[key];
        if (!gallery || gallery.length < 2) return;
        const img = document.getElementById(imgId);
        if (!img) return;
        const current = decodeURIComponent(img.src.replace(/^.*[\\/]/, '').replace(/\?.*$/, ''));
        let idx = gallery.findIndex(g => g.includes(current));
        if (idx === -1) idx = 0;
        idx = (idx + dir + gallery.length) % gallery.length;
        img.src = gallery[idx];
        const parent = img.closest('.boat-image-container, .passenger-variant-card, .specs-variant-card, #specsModalImgWrap');
        if (parent) {
            parent.querySelectorAll('.gallery-thumb').forEach(t => {
                const tSrc = t.getAttribute('src').replace(/^.*[\\/]/, '').replace(/\?.*$/, '');
                const newSrc = decodeURIComponent(gallery[idx].replace(/^.*[\\/]/, '').replace(/\?.*$/, ''));
                t.classList.toggle('active', tSrc === newSrc);
            });
        }
    }

    window.nextBoatImg = function(imgId, key) { shiftBoatImg(imgId, key, 1); };
    window.prevBoatImg = function(imgId, key) { shiftBoatImg(imgId, key, -1); };

    window.switchBoatImage = function(imgId, src, thumbEl) {
        const img = document.getElementById(imgId);
        if (img) img.src = src;
        const parent = thumbEl?.parentNode;
        if (parent) {
            parent.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
            thumbEl.classList.add('active');
        }
    };

    let fsKey = null;
    let fsIdx = 0;

    window.openFullscreen = function(imgEl) {
        if (!imgEl) return;
        const key = imgEl.dataset.galleryKey || imgEl.closest('#specsModalImgWrap')?.dataset.boatKey;
        if (!key || !boatGalleries[key]) return;
        const gallery = boatGalleries[key];
        const current = decodeURIComponent(imgEl.src.replace(/^.*[\\/]/, '').replace(/\?.*$/, ''));
        fsIdx = gallery.findIndex(g => g.includes(current));
        if (fsIdx === -1) fsIdx = 0;
        fsKey = key;
        const fsImg = document.getElementById("fullscreenImg");
        fsImg.src = gallery[fsIdx];
        document.getElementById("fullscreenCaption").textContent = key;
        document.getElementById("fullscreenModal").classList.add("show");
        document.getElementById("fsPrevBtn").onclick = () => shiftFs(-1);
        document.getElementById("fsNextBtn").onclick = () => shiftFs(1);
        document.body.style.overflow = "hidden";
    };

    window.closeFullscreen = function(e) {
        if (e && e.target !== e.currentTarget) return;
        document.getElementById("fullscreenModal").classList.remove("show");
        document.body.style.overflow = "";
        fsKey = null;
    };

    function shiftFs(dir) {
        if (!fsKey) return;
        const gallery = boatGalleries[fsKey];
        if (!gallery || gallery.length < 2) return;
        fsIdx = (fsIdx + dir + gallery.length) % gallery.length;
        document.getElementById("fullscreenImg").src = gallery[fsIdx];
    }

    document.addEventListener("keydown", function(e) {
        if (!document.getElementById("fullscreenModal").classList.contains("show")) return;
        if (e.key === "Escape") closeFullscreen();
        if (e.key === "ArrowLeft") shiftFs(-1);
        if (e.key === "ArrowRight") shiftFs(1);
    });

    document.getElementById("passengerModalClose").addEventListener("click", () => {
        document.getElementById("passengerModal").classList.remove("show");
    });
    document.getElementById("passengerModal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) document.getElementById("passengerModal").classList.remove("show");
    });

    const specsData = {
        "Patrol Boat": {
            image: "./images/patrol (preview).png",
            desc: "A fast and durable patrol boat designed for coastal security, law enforcement, and marine surveillance operations.",
            order: ["Patrol Boat", "\u20B115,000,000", "8 Months", "\u20B14,500,000", "./images/patrol (preview).png"],
            specs: [
                ["Length Overall", "12.0 m"],
                ["Beam", "3.3 m"],
                ["Mold Depth", "1.5 m"],
                ["Draft", "0.45 m"],
                ["Engine Power", "500 HP"],
                ["Speed", "32 knots"],
                ["Complement", "4 persons"],
                ["Fuel Capacity", "1,000 L"]
            ]
        },
        "Passenger Boat": {
            image: "./images/1950(preview).png",
            desc: "A comfortable and spacious passenger boat perfect for island hopping, coastal tours, and marine transportation.",
            variants: [
                {
                    name: "1950 Passenger Boat",
                    subtitle: "Medium-range island transport",
                    image: "./images/1950(preview).png",
                    price: "\u20B150,000,000",
                    downpayment: "\u20B115,000,000 (30%)",
                    order: ["1950 Passenger Boat", "\u20B150,000,000", "8 Months", "\u20B115,000,000", "./images/1950(preview).png"],
                    specs: [
                        ["Length Overall", "19.5 m"],
                        ["Beam", "4.2 m"],
                        ["Mold Depth", "1.6 m"],
                        ["Draft", "0.6 m"],
                        ["Engine Power", "700 HP"],
                        ["Aux. Engine", "8 kW"],
                        ["Speed", "18 knots"],
                        ["Complement", "65 persons"],
                        ["Fuel Capacity", "1,000 L"]
                    ]
                },
                {
                    name: "2680 Passenger Boat",
                    subtitle: "High-performance long-range fastcraft",
                    image: "./images/2680 (preview).png",
                    price: "\u20B1115,000,000",
                    downpayment: "\u20B134,500,000 (30%)",
                    order: ["2680 Passenger Boat", "\u20B1115,000,000", "14 Months", "\u20B134,500,000", "./images/2680 (preview).png"],
                    specs: [
                        ["Length Overall", "26.8 m"],
                        ["Beam", "6.0 m"],
                        ["Mold Depth", "2.3 m"],
                        ["Draft", "1.3 m"],
                        ["Engine Power", "1800 HP x 2"],
                        ["Aux. Engine", "38 kW x 2"],
                        ["Speed", "25 knots"],
                        ["Complement", "180 persons"],
                        ["Fuel Capacity", "6,000 L"]
                    ]
                }
            ]
        },
        "Speed Boat": {
            image: "./images/speed (preview).jpg",
            desc: "A high-performance speed boat built for fast water travel, water sports, and recreational activities.",
            order: ["Speed Boat", "\u20B11,400,000", "10 Months", "\u20B1420,000", "./images/speed (preview).jpg"],
            specs: [
                ["Length Overall", "5.8 m"],
                ["Beam", "2.25 m"],
                ["Mold Depth", "0.9 m"],
                ["Draft", "0.45 m"],
                ["Engine Power", "90-115 HP"],
                ["Speed", "36-40 knots"],
                ["Complement", "5 persons"],
                ["Fuel Capacity", "90 L"]
            ]
        },
        "Parasail Boat": {
            image: "./images/parasail(preview).png",
            desc: "A specialized parasail boat designed for thrilling water adventures and tourism.",
            order: ["Parasail Boat", "\u20B18,500,000", "12 Months", "\u20B12,550,000", "./images/parasail(preview).png"],
            specs: [
                ["Length Overall", "11.0 m"],
                ["Beam", "3.0 m"],
                ["Mold Depth", "1.5 m"],
                ["Draft", "0.5 m"],
                ["Engine Power", "300 HP"],
                ["Speed", "20 knots"],
                ["Fuel Capacity", "200 L"]
            ]
        }
    };

    const boatGalleries = {
        "Patrol Boat": ["./images/patrol (preview).png","./images/patrol (1).jpg","./images/patrol (2).jpg","./images/patrol (3).jpg","./images/patrol (1).png"],
        "Speed Boat": ["./images/speed (preview).jpg","./images/speed.png","./images/speed1.png"],
        "Parasail Boat": ["./images/parasail(preview).png","./images/parasaril.png"],
        "1950 Passenger Boat": ["./images/1950(preview).png","./images/1950 (2).jpg","./images/1950 (3).jpg","./images/1950 (4).jpg","./images/1950 (5).jpg","./images/1950 (6).jpg","./images/1950 (7).jpg"],
        "2680 Passenger Boat": ["./images/2680 (preview).png","./images/2680.png"]
    };

    function renderBoats() {
        const grid = document.getElementById("boatsGrid");
        if (!grid) return;
        const keys = Object.keys(specsData).filter(k => k !== "Passenger Boat");
        keys.unshift("Passenger Boat");
        grid.innerHTML = keys.map(key => {
            const d = specsData[key];
            const gallery = boatGalleries[key] || [d.image];
            const isPass = key === "Passenger Boat";
            const firstVariant = isPass && d.variants ? d.variants[0] : null;
            const order = d.order || (firstVariant ? firstVariant.order : ["", "₱0", "", "₱0"]);
            const gi = gallery.length > 1 ? `<div class="gallery-thumbs">${gallery.map((g, i) =>
                `<img class="gallery-thumb${i === 0 ? ' active' : ''}" src="${g}" onclick="switchBoatImage('boatImg_${key.replace(/\s/g,'')}','${g}',this)">`
            ).join('')}</div>` : '';
            const carLeft = gallery.length > 1 ? `<button class="carousel-arrow left" onclick="prevBoatImg('boatImg_${key.replace(/\s/g,'')}','${key}')">&#9664;</button>` : '';
            const carRight = gallery.length > 1 ? `<button class="carousel-arrow right" onclick="nextBoatImg('boatImg_${key.replace(/\s/g,'')}','${key}')">&#9654;</button>` : '';
            return `
            <div class="boat-card">
                <div class="boat-image-container">
                    <div class="img-carousel">
                        ${carLeft}
                        <img id="boatImg_${key.replace(/\s/g,'')}" src="${d.image}" alt="${key}" data-gallery-key="${key}" onclick="openFullscreen(this)" style="cursor:pointer;">
                        ${carRight}
                    </div>
                    ${gi}
                </div>
                <div class="boat-content">
                    <h3>${key}</h3>
                    <p class="price">${order[1]}</p>
                    <p class="boat-desc">${d.desc}</p>
                    <div class="boat-info-list">
                        <p>Estimated Build: ${order[2]}</p>
                        <p>Downpayment: ${order[3]}</p>
                    </div>
                    <div class="boat-actions">
                        <button class="order-now order-now-btn" data-boat-key="${key}">ORDER NOW</button>
                        <button class="view-specs view-specs-btn" data-boat-key="${key}">VIEW SPECS</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function renderPassengerModal() {
        const container = document.getElementById("passengerModalVariants");
        if (!container) return;
        const data = specsData["Passenger Boat"];
        if (!data || !data.variants) return;
        container.innerHTML = data.variants.map(v => {
            const gallery = boatGalleries[v.name] || [];
            const thumbs = gallery.map((g, i) =>
                `<img class="gallery-thumb${i === 0 ? ' active' : ''}" src="${g}" onclick="switchBoatImage('modalImg_${v.name.replace(/\s/g,'')}','${g}',this)">`
            ).join('');
            const carLeft = gallery.length > 1 ? `<button class="carousel-arrow left" onclick="prevBoatImg('modalImg_${v.name.replace(/\s/g,'')}','${v.name}')">&#9664;</button>` : '';
            const carRight = gallery.length > 1 ? `<button class="carousel-arrow right" onclick="nextBoatImg('modalImg_${v.name.replace(/\s/g,'')}','${v.name}')">&#9654;</button>` : '';
            return `
            <div class="passenger-variant-card" style="flex:1;min-width:260px;background:#f8fafc;border-radius:16px;padding:12px;border:2px solid #e2e8f0;text-align:center;">
                <div class="img-carousel" style="width:100%;">
                    ${carLeft}
                    <img id="modalImg_${v.name.replace(/\s/g,'')}" src="${v.image}" alt="${v.name}" data-gallery-key="${v.name}" onclick="openFullscreen(this)" style="width:100%;height:400px;object-fit:cover;border-radius:12px;cursor:pointer;">
                    ${carRight}
                </div>
                ${thumbs ? `<div class="gallery-thumbs" style="margin-top:6px;">${thumbs}</div>` : ''}
                <h3 style="font-size:16px;margin:6px 0 2px;">${v.name}</h3>
                <p style="font-size:12px;color:#64748b;margin-bottom:6px;">${v.subtitle}</p>
                <div style="text-align:left;font-size:11px;color:#334155;line-height:1.4;">
                    ${v.specs.slice(0, 4).map(s => `<p><strong>${s[0]}:</strong> ${s[1]}</p>`).join('')}
                </div>
                <p style="font-size:17px;font-weight:700;color:#1e293b;margin:6px 0;">${v.price}</p>
                <p style="font-size:12px;color:#64748b;margin-bottom:6px;">Downpayment: ${v.downpayment}</p>
                <button class="order-btn" onclick="orderBoat('${v.name.replace(/'/g, "\\'")}','${v.price}','${v.order[2]}','${v.order[3]}','${v.image}');document.getElementById('passengerModal').classList.remove('show');" style="margin-top:0;">Select & Order</button>
            </div>`;
        }).join('');
    }

    renderBoats();

    document.getElementById("boatsGrid").addEventListener("click", (e) => {
        const orderBtn = e.target.closest(".order-now-btn");
        if (orderBtn) {
            const key = orderBtn.dataset.boatKey;
            if (key === "Passenger Boat") {
                renderPassengerModal();
                document.getElementById("passengerModal").classList.add("show");
            } else {
                const data = specsData[key];
                if (data) orderBoat(...data.order);
            }
            return;
        }
        const specsBtn = e.target.closest(".view-specs-btn");
        if (specsBtn) {
            const key = specsBtn.dataset.boatKey;
            if (key === "Passenger Boat") openPassengerSpecs();
            else openSpecs(key);
        }
    });

    let currentSpecsBoat = null;

    function openSpecs(boatKey) {
        const data = specsData[boatKey];
        if (!data) return;
        currentSpecsBoat = boatKey;
        const wrap = document.getElementById("specsModalImgWrap");
        wrap.dataset.boatKey = boatKey;
        document.getElementById("specsModalImg").style.display = "block";
        document.getElementById("specsModalImg").src = data.image;
        document.getElementById("specsModalImg").dataset.galleryKey = boatKey;
        document.getElementById("specsModalName").textContent = boatKey;
        document.getElementById("specsModalDesc").textContent = data.desc;
        document.getElementById("specsActions").style.display = "flex";
        const container = document.getElementById("specsTable");
        container.innerHTML = `<table class="specs-table">${data.specs.map(s =>
            `<tr><td>${s[0]}</td><td>${s[1]}</td></tr>`
        ).join("")}</table>`;
        const existingGallery = document.querySelector("#specsModalImgWrap .gallery-thumbs");
        if (existingGallery) existingGallery.remove();
        const gallery = boatGalleries[boatKey];
        const hasGallery = gallery && gallery.length > 1;
        wrap.querySelectorAll(".carousel-arrow").forEach(a => a.style.display = hasGallery ? "flex" : "none");
        if (hasGallery) {
            const wrap = document.getElementById("specsModalImgWrap");
            const thumbsDiv = document.createElement("div");
            thumbsDiv.className = "gallery-thumbs";
            thumbsDiv.style.marginTop = "12px";
            gallery.forEach(src => {
                const thumb = document.createElement("img");
                thumb.className = "gallery-thumb" + (src === data.image ? " active" : "");
                thumb.src = src;
                thumb.onclick = () => switchBoatImage("specsModalImg", src, thumb);
                thumbsDiv.appendChild(thumb);
            });
            wrap.appendChild(thumbsDiv);
        }
        document.getElementById("specsModal").classList.add("show");
    }

    function openPassengerSpecs() {
        const data = specsData["Passenger Boat"];
        if (!data || !data.variants) return;
        currentSpecsBoat = "Passenger Boat";
        document.getElementById("specsModalImg").style.display = "none";
        document.getElementById("specsModalName").textContent = "Passenger Boat";
        document.getElementById("specsModalDesc").textContent = "Choose your passenger vessel variant";
        document.getElementById("specsActions").style.display = "none";
        const container = document.getElementById("specsTable");
        container.innerHTML = `<div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:8px;align-items:flex-start;">${data.variants.map(v => `
            <div class="specs-variant-card">
                <div class="img-carousel">
                    <button class="carousel-arrow left" onclick="prevBoatImg('variantImg_${v.name.replace(/\s/g,'')}','${v.name}')">&#9664;</button>
                    <img src="${v.image}" alt="${v.name}" class="specs-variant-img" id="variantImg_${v.name.replace(/\s/g,'')}" data-gallery-key="${v.name}" onclick="openFullscreen(this)" style="cursor:pointer;">
                    <button class="carousel-arrow right" onclick="nextBoatImg('variantImg_${v.name.replace(/\s/g,'')}','${v.name}')">&#9654;</button>
                </div>
                <div class="gallery-thumbs">
                    ${(boatGalleries[v.name] || []).map((gSrc, gi) =>
                        `<img class="gallery-thumb${gi === 0 ? ' active' : ''}" src="${gSrc}" onclick="switchBoatImage('variantImg_${v.name.replace(/\s/g,'')}','${gSrc}',this)">`
                    ).join("")}
                </div>
                <h3 style="font-size:18px;margin:14px 0 4px;">${v.name}</h3>
                <p style="font-size:13px;color:#64748b;margin-bottom:14px;">${v.subtitle}</p>
                <table class="specs-table">
                    ${v.specs.map(s => `<tr><td>${s[0]}</td><td>${s[1]}</td></tr>`).join("")}
                </table>
                <p style="font-size:22px;font-weight:700;color:#1e293b;margin:16px 0;">${v.price}</p>
                <p style="font-size:13px;color:#64748b;margin-bottom:14px;">Downpayment: ${v.downpayment}</p>
                <button class="order-btn" onclick="orderBoat('${v.name.replace(/'/g, "\\'")}','${v.price}','${v.order[2]}','${v.order[3]}','${v.image}');document.getElementById('specsModal').classList.remove('show');">ORDER NOW</button>
            </div>
        `).join("")}</div>`;
        document.getElementById("specsModal").classList.add("show");
    }

    document.getElementById("specsModalClose").addEventListener("click", () => {
        document.getElementById("specsModal").classList.remove("show");
    });
    document.getElementById("specsCloseBtn").addEventListener("click", () => {
        document.getElementById("specsModal").classList.remove("show");
    });
    document.getElementById("specsModal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) document.getElementById("specsModal").classList.remove("show");
    });
    document.getElementById("specsOrderBtn").addEventListener("click", () => {
        if (!currentSpecsBoat) return;
        const data = specsData[currentSpecsBoat];
        if (data) {
            if (currentSpecsBoat === "Passenger Boat") {
                renderPassengerModal();
                document.getElementById("passengerModal").classList.add("show");
            } else {
                orderBoat(...data.order);
            }
            document.getElementById("specsModal").classList.remove("show");
        }
    });

    document.getElementById("orderSummaryClose").addEventListener("click", () => {
        document.getElementById("orderSummaryModal").classList.remove("show");
    });
    document.getElementById("orderSummaryModal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) document.getElementById("orderSummaryModal").classList.remove("show");
    });
});

window.reviseDesign = function(orderId) {
    const encoded = btoa(orderId);
    window.location.href = "boatcust.html?mode=revision&order=" + encoded;
};

window.resubmitSchedule = function(orderId) {
    const encoded = btoa(orderId);
    window.location.href = "order.html?mode=reschedule&order=" + encoded;
};
