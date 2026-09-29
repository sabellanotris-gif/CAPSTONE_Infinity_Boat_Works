import { supabase, handleDbError } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

(async function init() {
  const auth = await window.requireRole(["manager", "admin"]);
  if (!auth) return;

  sessionStorage.setItem("role", auth.profile.role);
  document.getElementById("managerName").textContent = auth.profile.name || "Project Manager";

  const result = await handleDbError(
    supabase.from("boat_orders").select("*").order("createdAt", { ascending: false }),
    "Load orders"
  );
  const orders = (result && !result.error ? result.data : []) || [];

  const completed = orders.filter(o => o.status === "Completed" || o.progress >= 100).length;
  const inProgress = orders.filter(o => o.status === "In Progress" || (o.progress > 0 && o.progress < 100 && o.status !== "Cancelled" && o.status !== "Rejected")).length;
  const pending = orders.filter(o => o.status === "Pending" || o.status === "Under Review" || o.status === "Pending Signing" || o.status === "Revision Required").length;

  document.getElementById("statActive").textContent = inProgress;
  document.getElementById("statCompleted").textContent = completed;
  document.getElementById("statPending").textContent = pending;

  const recent = orders.slice(0, 6);
  const list = document.getElementById("recentOrders");
  if (recent.length === 0) {
    list.innerHTML = '<div style="padding:28px;text-align:center;color:#94a3b8;font-size:14px;">No boat projects yet.</div>';
    return;
  }

  list.innerHTML = recent.map(o => {
    const statusColor = o.status === "Completed" ? "#22c55e"
      : o.status === "Rejected" || o.status === "Cancelled" ? "#ef4444"
      : o.status === "Approved" || o.status === "In Progress" ? "#2563eb" : "#f59e0b";
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;">' +
      '<div>' +
        '<strong style="font-size:14px;color:#0f172a;">' + esc(o.boatName) + '</strong>' +
        '<div style="font-size:12px;color:#64748b;">' + esc(o.customerName || "Unknown") + ' · ' + (o.progress || 0) + '% complete</div>' +
      '</div>' +
      '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';background:' + statusColor + '1a;padding:4px 10px;border-radius:999px;white-space:nowrap;">' + esc(o.status) + '</span>' +
    '</div>';
  }).join("");
})();

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}