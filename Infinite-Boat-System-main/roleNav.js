(function () {
  var role = localStorage.getItem("role");
  if (role !== "manager") return;

  var adminOnly = ["dashcustomer.html", "dashpayment.html", "dashinventory.html", "dashapproval.html", "dashdelivery.html"];

  document.querySelectorAll(".sidebar-menu a").forEach(function (a) {
    var href = (a.getAttribute("href") || "").trim().toLowerCase();
    if (href === "dashboard.html") {
      a.setAttribute("href", "manager.html");
      a.textContent = "Dashboard";
    }
    if (adminOnly.indexOf(href) !== -1) {
      a.remove();
    }
  });
})();