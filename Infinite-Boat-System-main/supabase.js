import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://brpblkvthpdfbjqckqbk.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJycGJsa3Z0aHBkZmJqcWNrcWJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODU3MTEsImV4cCI6MjA5NzQ2MTcxMX0.lTaInjC-MbYS1w1PVbN-RVK6_1Cj2pPAei4CpWj8G9w";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export { supabaseUrl };

// API base URL — uses port 3000 for Express API, auto-detect if already on port 3000
const port = window.location.port;
export const API_BASE = (port === "3000" ? window.location.origin : "http://localhost:3000") + "/api";

export async function handleDbError(promise, context = '') {
  try {
    const { data, error } = await promise;
    if (error) {
      console.error(`[DB Error] ${context}:`, error);
      showToast(`Database error: ${error.message || error.details || 'Unknown'}`, 'error');
      return { error, data: null };
    }
    return { data, error: null };
  } catch (err) {
    console.error(`[Exception] ${context}:`, err);
    showToast(`Unexpected error: ${err.message}`, 'error');
    return { error: err, data: null };
  }
}

/* =============================================
   UTILITY HELPERS
   ============================================= */

export function parseContractSchedule(order) {
    if (!order || !order.contractSchedule) return null;
    let s = order.contractSchedule;
    if (typeof s === "string") {
        try { s = JSON.parse(s); } catch (e) { return null; }
    }
    return s;
}

export function formatScheduleDate(dateStr) {
    if (!dateStr) return "N/A";
    try {
        return new Date(dateStr + "T12:00:00").toLocaleDateString('en-PH', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    } catch (e) { return dateStr; }
}

export function formatScheduleDateTime(dateStr, timeStr) {
    const d = formatScheduleDate(dateStr);
    const t = timeStr || "N/A";
    return d + " at " + t;
}

window.parseContractSchedule = parseContractSchedule;
window.formatScheduleDate = formatScheduleDate;
window.formatScheduleDateTime = formatScheduleDateTime;

/* =============================================
   TOAST NOTIFICATION
   ============================================= */

export function showToast(message, type = "info") {
    const existing = document.querySelector(".rt-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "rt-toast";
    const icons = { success: "fa-circle-check", error: "fa-circle-xmark", warning: "fa-triangle-exclamation", info: "fa-bell" };
    const colors = { success: "#22c55e", error: "#ef4444", warning: "#f59e0b", info: "#295dff" };
    toast.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:99999;
        background:#fff; border-radius:12px; padding:14px 20px;
        box-shadow:0 8px 32px rgba(0,0,0,0.18);
        display:flex; align-items:center; gap:12px;
        font:14px/1.5 'Poppins',sans-serif; color:#0f172a;
        border-left:4px solid ${colors[type] || colors.info};
        transform:translateY(20px); opacity:0;
        transition:all 0.3s ease; max-width:400px;
    `;
    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info}" style="color:${colors[type] || colors.info};font-size:18px;"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#94a3b8;padding:0 0 0 8px;">&times;</button>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = "translateY(0)"; toast.style.opacity = "1"; });
    setTimeout(() => { toast.style.transform = "translateY(20px)"; toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 5000);
}

window.showToast = showToast;

/* =============================================
   REALTIME NOTIFICATION SOUND
   ============================================= */

export function notifySound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 800; o.type = "sine";
        g.gain.value = 0.1;
        o.start(); o.stop(ctx.currentTime + 0.15);
    } catch (e) { /* sound not supported */ }
}

window.notifySound = notifySound;

/* =============================================
   EMAIL NOTIFICATION HELPER
   ============================================= */

export async function sendEmailNotification({ type, recipient, orderId, paymentId, data } = {}) {
  if (!recipient) return;
  try {
    await fetch(API_BASE + "/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, orderId, paymentId, recipient, data }),
    });
  } catch (err) {
    console.error("[EMAIL] Failed to send:", err);
  }
}
