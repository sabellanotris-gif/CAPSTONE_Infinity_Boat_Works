import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* =============================================
   AUTH / SESSION HELPERS
   ============================================= */

// Ensure a valid (non-expired) Supabase session and return its access token.
// Refreshes the token if it is about to expire or already expired.
export async function ensureSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    try {
      const payload = JSON.parse(atob(session.access_token.split(".")[1]));
      const expiresIn = payload.exp * 1000 - Date.now();
      if (expiresIn < 60000) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        return refreshed?.session?.access_token || session.access_token;
      }
    } catch (e) {
      // token decode failed — fall through and return the existing token
    }
    return session.access_token;
  } catch (e) {
    console.error("[AUTH] ensureSession error:", e);
    return null;
  }
}

// Ensure the current Supabase user is still signed in, returning the session or null.
export async function getSessionOrNull() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  } catch (e) {
    console.error("[AUTH] getSession error:", e);
    return null;
  }
}

// Re-fetch the logged-in user's profile from the DB. Falls back to localStorage
// values when there is no userId or the lookup fails.
export async function getCustomerIdentity() {
  const userId = localStorage.getItem("userId");
  const fallback = {
    name: localStorage.getItem("customerName") || "",
    email: localStorage.getItem("customerEmail") || "",
    phone: localStorage.getItem("customerPhone") || "",
    photo: localStorage.getItem("customerImage") || "",
  };
  if (!userId) return fallback;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("name, email, phone, photo")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data || !data.name) return fallback;
    return {
      name: data.name || fallback.name,
      email: data.email || fallback.email,
      phone: data.phone || fallback.phone,
      photo: data.photo || fallback.photo,
    };
  } catch (e) {
    return fallback;
  }
}

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

// Refresh the session if the current access token is missing or about to
// expire. Returns the session (refreshed if needed) or null if there is none.
export async function refreshValidSession() {
  try {
    const { data: { session: cur } } = await supabase.auth.getSession();
    if (!cur?.access_token) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      return refreshed?.session || null;
    }
    try {
      const payload = JSON.parse(atob(cur.access_token.split(".")[1]));
      const expiresIn = payload.exp * 1000 - Date.now();
      if (expiresIn < 300000) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        return refreshed?.session || cur;
      }
    } catch (e) { /* not a JWT we can decode — keep current */ }
    return cur;
  } catch (e) {
    return null;
  }
}

window.refreshValidSession = refreshValidSession;

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
