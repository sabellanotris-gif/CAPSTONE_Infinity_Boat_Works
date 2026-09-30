/* =========================================
   SHARED SIDEBAR NAVIGATION
   =========================================
   Single source of truth for the admin/manager sidebar.

   Every page ships an empty <nav class="sidebar-menu"></nav>
   and loads this file immediately after it. Editing the nav
   means editing this array only — not 12 HTML files.

   Also injects the <= 900px off-canvas drawer toggle.

   Kept free of <i> elements on purpose: the labels carry
   the menu, so nothing here depends on an icon font.
   ========================================= */

(function () {
  "use strict";

  var OPEN_STATE_KEY = "sidebarNavOpen";
  var POLL_LIMIT = 20;

  /* adminOnly entries are removed entirely for non-admin roles. */
  var NAV = [
    { label: "Dashboard", href: "dashboard.html", managerHref: "manager.html" },
    {
      key: "sales",
      label: "Sales & Finance",
      children: [
        { label: "Sales Report", href: "dashsales.html" },
        { label: "Payments", href: "dashpayment.html", adminOnly: true },
        { label: "Analytics", href: "dashanalytics.html" }
      ]
    },
    {
      key: "orders",
      label: "Orders & Customers",
      children: [
        { label: "Orders", href: "dashorder.html" },
        { label: "Customers", href: "dashcustomer.html", adminOnly: true }
      ]
    },
    {
      key: "production",
      label: "Production",
      children: [
        { label: "Boat Progress", href: "dashprogress.html" },
        { label: "Workers", href: "dashworkers.html" },
        { label: "Inventory", href: "dashinventory.html", adminOnly: true }
      ]
    },
    { label: "Approvals", href: "dashapproval.html", adminOnly: true }
  ];

  var nav = document.querySelector(".sidebar-menu");
  if (!nav) return;

  var timer = null;

  /* =========================================
     ROUTE MATCHING
     =========================================
     Full pathname + search compare, not a substring test.
     Without this, ?tab=payments and ?tab=analytics would
     both light up because they share a filename.
     ========================================= */
  function routeOf(href) {
    var url = new URL(href, location.href);
    return url.pathname.toLowerCase() + url.search.toLowerCase();
  }

  function currentRoute() {
    return routeOf(location.href);
  }

  function isActive(href) {
    return routeOf(href) === currentRoute();
  }

  /* =========================================
     ROLE
     ========================================= */
  function activeRole() {
    var verified = window.__activeProfile && window.__activeProfile.role;
    if (verified) return verified;
    return sessionStorage.getItem("role") || "";
  }

  function hrefFor(item, role) {
    if (role === "manager" && item.managerHref) return item.managerHref;
    return item.href;
  }

  /* =========================================
     TREE: filter, then normalise group shape
     =========================================
     A group is rendered as a collapsible only when it has
     two or more visible children. Managers lose four
     entries, so a group can end up with one child — showing
     a header that opens a single link is noise, so that
     child gets promoted to a plain top-level link instead.
     ========================================= */
  function buildTree(role) {
    var isAdmin = role === "admin";

    return NAV.map(function (item) {
      if (!item.children) {
        if (item.adminOnly && !isAdmin) return null;
        var href = hrefFor(item, role);
        return { label: item.label, href: href, active: isActive(href) };
      }

      var kids = item.children
        .filter(function (child) { return isAdmin || !child.adminOnly; })
        .map(function (child) {
          var childHref = hrefFor(child, role);
          return { label: child.label, href: childHref, active: isActive(childHref) };
        });

      if (kids.length === 0) return null;
      if (kids.length === 1) return kids[0];

      return {
        key: item.key,
        label: item.label,
        children: kids,
        current: kids.some(function (child) { return child.active; })
      };
    }).filter(Boolean);
  }

  /* =========================================
     OPEN-STATE PERSISTENCE
     ========================================= */
  function readOpenState() {
    try {
      return JSON.parse(localStorage.getItem(OPEN_STATE_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function writeOpenState(state) {
    try {
      localStorage.setItem(OPEN_STATE_KEY, JSON.stringify(state));
    } catch (err) {
      /* private mode / quota — collapse state just won't survive reload */
    }
  }

  /* A group holding the current page is always opened, regardless
     of the remembered state, so the active link is never hidden. */
  function isGroupOpen(node, state) {
    if (node.current) return true;
    return state[node.key] === true;
  }

  /* =========================================
     RENDER
     ========================================= */
  function linkHtml(item) {
    return '<a href="' + item.href + '"' + (item.active ? ' class="active"' : "") + ">" + item.label + "</a>";
  }

  function nodeHtml(node, state) {
    if (!node.children) return linkHtml(node);

    var open = isGroupOpen(node, state);
    var classes = "nav-group" + (open ? "" : " collapsed") + (node.current ? " is-current" : "");
    var kids = node.children.map(linkHtml).join("");

    return (
      '<div class="' + classes + '">' +
      '<button type="button" class="nav-group-btn" data-nav-key="' + node.key + '"' +
      ' aria-expanded="' + (open ? "true" : "false") + '">' + node.label + "</button>" +
      '<div class="nav-sub">' + kids + "</div>" +
      "</div>"
    );
  }

  function render() {
    var role = activeRole();
    var state = readOpenState();

    nav.innerHTML = buildTree(role)
      .map(function (node) { return nodeHtml(node, state); })
      .join("");

    nav.setAttribute("data-role", role);
  }

  /* =========================================
     GROUP TOGGLE
     ========================================= */
  nav.addEventListener("click", function (event) {
    var btn = event.target.closest(".nav-group-btn");
    if (!btn) return;

    var group = btn.parentElement;
    var key = btn.getAttribute("data-nav-key");
    var wasOpen = btn.getAttribute("aria-expanded") === "true";

    btn.setAttribute("aria-expanded", wasOpen ? "false" : "true");
    group.classList.toggle("collapsed", wasOpen);

    var state = readOpenState();
    state[key] = !wasOpen;
    writeOpenState(state);
  });

  /* =========================================
     MOBILE DRAWER
     ========================================= */
  function setupDrawer() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.id = "navToggle";
    toggle.setAttribute("aria-label", "Toggle navigation");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span>";

    var scrim = document.createElement("div");
    scrim.className = "nav-scrim";
    scrim.id = "navScrim";

    document.body.appendChild(toggle);
    document.body.appendChild(scrim);

    function setOpen(open) {
      sidebar.classList.toggle("open", open);
      scrim.classList.toggle("show", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    scrim.addEventListener("click", function () { setOpen(false); });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });

    /* Leaving the drawer open would strand the scrim over a desktop
       layout that no longer knows what it is for. */
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) setOpen(false);
    });
  }

  /* =========================================
     BOOT
     =========================================
     Paint immediately from the role login.js already put in
     sessionStorage, so a manager never sees an admin link flash
     by. Then wait briefly for the verified role and repaint only
     if it disagrees.
     ========================================= */
  render();
  setupDrawer();

  var polls = 0;
  timer = setInterval(function () {
    if (++polls > POLL_LIMIT) {
      clearInterval(timer);
      return;
    }

    var painted = nav.getAttribute("data-role") || "";
    var verified = (window.__activeProfile && window.__activeProfile.role) || "";

    if (verified && verified !== painted) {
      render();
      clearInterval(timer);
    }
  }, 250);
})();
