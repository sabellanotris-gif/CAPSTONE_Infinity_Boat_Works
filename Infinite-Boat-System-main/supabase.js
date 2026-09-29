import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* =============================================
   AUTH / SESSION HELPERS
   ============================================= */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where each role logically lands after sign-in / guard routing. Redirecting to
// the role-appropriate landing (instead of always bouncing to login.html)
// keeps the page consistent with the live session for that tab.
export function landingForRole(role) {
  if (role === "admin") return "dashboard.html";
  if (role === "manager") return "manager.html";
  if (role === "worker") return "worker.html";
  return "home.html";
}

// Decode a JWT payload without throwing on base64url characters (- and _).
// atob() rejects those, which used to silently disable the pre-expiry refresh.
function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function msUntilExpiry(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return Infinity; // unknown → treat as valid
  return payload.exp * 1000 - Date.now();
}

// True only for errors that genuinely mean "this session is no longer valid".
// Everything else (network, 5xx, RLS, timeouts) is transient and must NOT log
// the user out.
export function isSessionInvalidError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const status = Number(error.status || error.statusCode || 0);
  const msg = String(error.message || "").toLowerCase();
  if (code === "PGRST301" || code === "JWT_EXPIRED" || code === "INVALID_TOKEN") return true;
  if (status === 401) return true;
  return (
    msg.includes("jwt") && msg.includes("expired") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token not found") ||
    msg.includes("user not found") ||
    msg.includes("session_not_found")
  );
}

// Read the current session, retrying transient storage/network failures.
// Returns null ONLY when there is genuinely no session.
async function readSessionWithRetry(attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (isSessionInvalidError(error)) return null;
        lastErr = error;
      } else {
        return data?.session || null;
      }
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await sleep(200 * (i + 1));
  }
  console.warn("[AUTH] getSession failed after retries:", lastErr);
  return null;
}

// Attempt a refresh. Returns the new session, or null if the refresh token is
// genuinely invalid. Never throws.
async function tryRefresh() {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      if (isSessionInvalidError(error)) return null;
      console.warn("[AUTH] refreshSession error:", error.message);
      return null;
    }
    return data?.session || null;
  } catch (e) {
    console.warn("[AUTH] refreshSession threw:", e);
    return null;
  }
}

// Ensure a valid (non-expired) Supabase session and return its access token.
// Returns null ONLY when the user is genuinely signed out. A transient network
// failure while a session exists returns that session's token rather than null,
// so a save never signs the user out.
export async function ensureSession() {
  const session = await readSessionWithRetry();
  if (!session?.access_token) return null;

  if (msUntilExpiry(session.access_token) < 60000) {
    const refreshed = await tryRefresh();
    if (refreshed?.access_token) return refreshed.access_token;
    // Refresh failed. If the token we already hold is still unexpired, keep
    // using it — a failed refresh is not proof the session is dead.
    if (msUntilExpiry(session.access_token) > 0) {
      console.warn("[AUTH] refresh failed; continuing with still-valid token");
      return session.access_token;
    }
    // Token is genuinely expired and we could not renew it.
    return null;
  }
  return session.access_token;
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
  const userId = sessionStorage.getItem("userId");
  const fallback = {
    name: sessionStorage.getItem("customerName") || "",
    email: sessionStorage.getItem("customerEmail") || "",
    phone: sessionStorage.getItem("customerPhone") || "",
    photo: sessionStorage.getItem("customerImage") || "",
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

// Per-tab auth isolation (Option A):
// - Supabase persists ONE session per browser origin. When admin and manager
//   accounts are used in the same browser, the last login clobbers the shared
//   session and the UI "switches users". Storing the session in sessionStorage
//   keeps each tab on its own account without cross-tab interference.
// - The BroadcastChannel cross-tab sync is disabled so events from another tab
//   (SIGNED_IN/SIGNED_OUT) can never bleed into this tab's session or UI.
if (globalThis?.BroadcastChannel) globalThis.BroadcastChannel = undefined;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // A URL fragment carrying access_token/refresh_token (e.g. a verification
    // link) must not silently overwrite an active session.
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
    // Per-tab session: each tab (or window) keeps its own logged-in account.
    storage: window.sessionStorage || undefined,
  },
});
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
// expire. Returns the session (refreshed if needed) or null ONLY if there is
// genuinely none. Transient failures fall back to the existing session instead
// of bouncing the user to the login page.
export async function refreshValidSession() {
  const cur = await readSessionWithRetry();

  if (!cur?.access_token) {
    // No stored session — one refresh attempt in case a refresh token is still
    // valid server-side (e.g. a fresh page load before storage settled).
    return await tryRefresh();
  }

  if (msUntilExpiry(cur.access_token) < 300000) {
    const refreshed = await tryRefresh();
    if (refreshed) return refreshed;
    // Refresh failed. Keep the existing session if its token is still valid.
    if (msUntilExpiry(cur.access_token) > 0) return cur;
  }
  return cur;
}

window.refreshValidSession = refreshValidSession;

/* =============================================
   SHARED PAGE GUARD
   ============================================= */

// Fetch the caller's profile, retrying transient failures.
// Returns { profile, error }. error is non-null only when the read genuinely
// failed — callers must never treat a transient error as "no profile".
async function fetchOwnProfile(userId, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role, name, email, phone, photo")
        .eq("id", userId)
        .maybeSingle();
      if (!error) return { profile: data, error: null };
      if (isSessionInvalidError(error)) return { profile: null, error };
      console.warn(`[AUTH] profile read failed (attempt ${i + 1}/${attempts}):`, error.message);
      if (i < attempts - 1) await sleep(300 * (i + 1));
    } catch (e) {
      console.warn(`[AUTH] profile read threw (attempt ${i + 1}/${attempts}):`, e);
      if (i < attempts - 1) await sleep(300 * (i + 1));
    }
  }
  return { profile: null, error: new Error("Could not read profile") };
}

/* Shared auth + role guard for every protected page.
   - Redirects to login.html ONLY when there is genuinely no session, the
     session is provably invalid, or the role is genuinely not permitted.
   - A transient network/DB failure retries, then rethrows to fail closed on
     the *page render* without destroying the user's session.
   Returns the session and profile, or null when it has redirected. */
export async function requireRole(allowedRoles) {
  const session = await refreshValidSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  const { profile, error } = await fetchOwnProfile(session.user.id);
  if (error && isSessionInvalidError(error)) {
    window.location.href = "login.html";
    return null;
  }
  if (!profile) {
    if (error) {
      // Could not read the role even after retries. Do NOT sign the user out —
      // their session may be perfectly fine. Tell them and stop.
      console.error("[AUTH] profile unreadable after retries:", error);
      if (typeof showToast === "function") {
        showToast("Could not verify your access. Check your connection and reload.", "error");
      }
      document.body?.setAttribute("data-auth-state", "unverified");
      return null;
    }
    // No error and no row — the profile genuinely does not exist.
    window.location.href = "login.html";
    return null;
  }

  if (!allowedRoles.includes(profile.role)) {
    // Session is valid but belongs to a different role/account in this tab —
    // take that user to where their role actually lands instead of bouncing.
    window.location.href = landingForRole(profile.role);
    return null;
  }
  // Remember the verified role for non-module scripts (roleNav.js) and the
  // topbar identity refresher, without leaking it into shared storage.
  sessionStorage.setItem("role", profile.role);
  if (typeof window !== "undefined") {
    window.__activeProfile = profile;
  }
  return { session, profile };
}

window.requireRole = requireRole;

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
