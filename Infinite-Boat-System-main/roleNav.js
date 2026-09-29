(function () {
  var adminOnly = ["dashcustomer.html", "dashpayment.html", "dashinventory.html", "dashapproval.html", "dashdelivery.html"];

  function applyRoleNav(role) {
    role = role || sessionStorage.getItem("role");
    document.querySelectorAll(".sidebar-menu a").forEach(function (a) {
      var href = (a.getAttribute("href") || "").trim().toLowerCase();

      if (role === "manager") {
        if (href === "dashboard.html") {
          a.setAttribute("href", "manager.html");
          a.textContent = "Dashboard";
        }
        if (adminOnly.indexOf(href) !== -1) a.remove();
      }
    });
  }

  // Run immediately from sessionStorage (set by login.js / requireRole for this
  // tab). If the guard still hasn't resolved (async module import), re-apply
  // once the verified role is available so the sidebar always matches the
  // live session instead of a stale shared value.
  applyRoleNav();

  var polls = 0;
  var timer = setInterval(function () {
    var verified = window.__activeProfile && window.__activeProfile.role;
    if (verified) {
      clearInterval(timer);
      applyRoleNav(verified);
    } else if (++polls > 20) {
      clearInterval(timer);
    }
  }, 250);
})();