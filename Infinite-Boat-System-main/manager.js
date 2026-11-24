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

  // Fill the avatar + profile dropdown with the live identity
  const prettyName = (auth.profile.name || auth.profile.email || "Manager")
    .charAt(0).toUpperCase() + (auth.profile.name || auth.profile.email || "Manager").slice(1);
  const avatar = document.getElementById("adminprofile");
  if (avatar && auth.profile.photo) avatar.src = auth.profile.photo;
  const dropdownAvatar = document.getElementById("dropdownAvatar");
  const dropdownName = document.getElementById("dropdownName");
  const dropdownEmail = document.getElementById("dropdownEmail");
  if (dropdownAvatar && auth.profile.photo) dropdownAvatar.src = auth.profile.photo;
  if (dropdownName) dropdownName.textContent = prettyName;
  if (dropdownEmail) dropdownEmail.textContent = auth.profile.email || "";

  // Toggle the profile dropdown on avatar click
  const profileBtn = document.getElementById("adminProfileBtn");
  const profileDropdown = document.getElementById("adminProfileDropdown");
  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const opening = !profileDropdown.classList.contains("show");
      profileDropdown.classList.toggle("show");
      profileBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!profileBtn.contains(e.target) && !profileDropdown.contains(e.target)) {
        profileDropdown.classList.remove("show");
        profileBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        profileDropdown.classList.remove("show");
        profileBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.getElementById("dropdownLogoutBtn")?.addEventListener("click", () => {
      window.handleLogout();
    });
  }

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
    list.innerHTML = '<div class="dash-empty">No boat projects yet.</div>';
    return;
  }

  list.innerHTML = recent.map(o => {
    const statusClass = String(o.status || "pending")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pending";
    return '<div class="dash-row">' +
      '<div class="dash-row-main">' +
        '<strong class="dash-row-title">' + esc(o.boatName) + '</strong>' +
        '<div class="dash-row-meta">' + esc(o.customerName || "Unknown") + ' · ' + (o.progress || 0) + '% complete</div>' +
      '</div>' +
      '<span class="dash-status dash-status--' + statusClass + '">' + esc(o.status) + '</span>' +
    '</div>';
  }).join("");
})();

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}