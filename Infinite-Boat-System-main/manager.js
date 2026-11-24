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

  renderManagerProjects(orders);
})();

let activeManagerTab = 'Under Review';

function renderManagerProjects(orders) {
  const container = document.getElementById('managerProjectsContainer');
  if (!container) return;

  const groups = [
    { label: 'Under Review', statuses: ['Under Review'], icon: 'fa-wand-magic-sparkles', color: '#7c3aed' },
    { label: 'In Progress', statuses: ['Approved', 'In Progress'], icon: 'fa-hard-hat', color: '#16a34a' },
    { label: 'Completed', statuses: ['Completed'], icon: 'fa-circle-check', color: '#22c55e' }
  ];

  container.innerHTML = `
    <div class="project-tabs" role="tablist" aria-label="Boat project status">
      ${groups.map(g => `
        <button type="button" class="project-tab" role="tab" data-tab="${g.label}"
                aria-controls="managerTabPanel" aria-selected="false" tabindex="-1">
          <i class="fa-solid ${g.icon}" style="color:${g.color}"></i>
          <span>${g.label}</span>
          <span class="section-count">${orders.filter(o => g.statuses.includes(o.status)).length}</span>
        </button>`).join('')}
    </div>
    <div class="project-tab-panel" id="managerTabPanel" role="tabpanel"></div>`;

  container.querySelectorAll('.project-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeManagerTab = btn.dataset.tab;
      updateManagerProjectPanel(container, orders, groups);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const tabs = [...container.querySelectorAll('.project-tab')];
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(tabs.indexOf(btn) + step + tabs.length) % tabs.length];
      activeManagerTab = next.dataset.tab;
      updateManagerProjectPanel(container, orders, groups);
      next.focus();
    });
  });

  updateManagerProjectPanel(container, orders, groups);
}

function updateManagerProjectPanel(container, orders, groups) {
  const group = groups.find(g => g.label === activeManagerTab) || groups[0];
  activeManagerTab = group.label;
  const items = orders.filter(o => group.statuses.includes(o.status));

  container.querySelectorAll('.project-tab').forEach(btn => {
    const active = btn.dataset.tab === group.label;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });

  const panel = container.querySelector('.project-tab-panel');
  if (!panel) return;
  panel.innerHTML = items.length
    ? items.map(o => renderManagerProjectRow(o)).join('')
    : `<div class="project-tab-empty">No ${group.label.toLowerCase()} projects yet.</div>`;
}

function renderManagerProjectRow(o) {
  const progress = o.progress || 0;
  const statusColor = o.status === 'Completed' ? '#22c55e'
    : o.status === 'Rejected' || o.status === 'Cancelled' ? '#ef4444'
    : o.status === 'Approved' || o.status === 'In Progress' ? '#2563eb' : '#f59e0b';
  const image = o.buildType === 'custom' && o.customConfig?.boatPreviewImage
    ? o.customConfig.boatPreviewImage : (o.boatImage || './images/boat1.jpg');
  return `
    <div class="project-row">
      <div class="project-info">
        <img src="${esc(image)}" alt="">
        <div>
          <h3>${esc(o.boatName || 'Boat')}</h3>
          <p>Client: ${esc(o.customerName || 'Unknown')}</p>
        </div>
      </div>
      <div class="project-stage"></div>
      <div class="project-progress">
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%;"></div></div>
        <span>${progress}%</span>
      </div>
      <span class="status" style="background:${statusColor};">${esc(o.status)}</span>
    </div>`;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}