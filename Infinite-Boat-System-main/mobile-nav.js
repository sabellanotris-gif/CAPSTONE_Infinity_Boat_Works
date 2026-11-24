/* =========================================================
   MOBILE APP NAVIGATION — frontend only.
   Builds a bottom tab bar + More sheet from the links that
   already exist on the page. Clicks are delegated to the
   original elements, so logout, notifications and role-aware
   sidebar logic keep working without any backend changes.
   ========================================================= */
(function () {
  "use strict";

  var SKIP_PAGES = /^(index|login|registration|verification-success)\.html$/i;
  var pageName = (location.pathname.split("/").pop() || "").toLowerCase();
  if (SKIP_PAGES.test(pageName)) return;

  var body = document.body;
  if (!body) return;

  var ICONS = {
    "Home": "fa-house",
    "Projects": "fa-diagram-project",
    "Order Boat": "fa-ship",
    "Payments": "fa-credit-card",
    "Profile": "fa-user",
    "Customizer": "fa-sliders",
    "Notifications": "fa-bell",
    "Logout": "fa-right-from-bracket",
    "Dashboard": "fa-gauge",
    "Sales Report": "fa-chart-line",
    "Analytics": "fa-chart-pie",
    "Orders": "fa-box",
    "Customers": "fa-users",
    "Boat Progress": "fa-ship",
    "Workers": "fa-users-gear",
    "Delivery": "fa-truck",
    "Inventory": "fa-boxes-stacked",
    "Approvals": "fa-check-to-slot",
    "My Assignments": "fa-clipboard-list",
    "Back": "fa-arrow-left"
  };

  var CANONICAL = [
    { key: "home", label: "Home", href: "home.html", icon: "fa-house", match: /home|project|dashboard/i },
    { key: "order", label: "Order Boat", href: "order.html", icon: "fa-ship", match: /order/i },
    { key: "payments", label: "Payments", href: "payment.html", icon: "fa-credit-card", match: /payment/i },
    { key: "profile", label: "Profile", href: "profile.html", icon: "fa-user", match: /profile/i }
  ];

  var bar = null;
  var sheet = null;
  var scrim = null;
  var moreList = null;
  var moreButton = null;
  var currentSources = [];
  var lastSignature = "";
  var syncTimer = null;

  function textOf(el) {
    if (!el) return "";
    var label = el.getAttribute("aria-label") || "";
    if (label) return label.replace(/\s+/g, " ").trim();

    var raw = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw || /^\d+$/.test(raw)) {
      var fontIcon = el.querySelector("i.fa-solid, i.fa-regular, i.fa-brands");
      if (fontIcon && fontIcon.className) {
        var match = String(fontIcon.className).match(/fa-([a-z0-9-]+)/);
        if (match) return titleFromIcon(match[1]);
      }
    }
    return raw;
  }

  function titleFromIcon(name) {
    var found = "";
    Object.keys(ICONS).forEach(function (label) {
      if (ICONS[label] === "fa-" + name) found = label;
    });
    return found || "More";
  }

  function isNotification(el) {
    return !!el && /notif|bell/i.test(el.id + " " + String(el.className || ""));
  }

  function isLogout(el) {
    if (!el) return false;
    return el.classList.contains("logout-btn") || /handleLogout/i.test(el.getAttribute("onclick") || "");
  }

  function labelFor(el) {
    if (isNotification(el)) return "Notifications";
    if (isLogout(el)) return "Logout";
    return textOf(el) || "More";
  }

  function iconFor(el, label) {
    if (ICONS[label]) return ICONS[label];
    if (el) {
      var icon = el.querySelector("i.fa-solid, i.fa-regular, i.fa-brands");
      if (icon && icon.className) {
        var match = String(icon.className).match(/fa-([a-z0-9-]+)/);
        if (match) return "fa-" + match[1];
      }
    }
    return "fa-circle";
  }

  function makeVirtual(label, href, icon, extra) {
    var a = document.createElement("a");
    a.href = href || "#";
    a.setAttribute("data-mobile-virtual", "true");
    a.setAttribute("data-mobile-label", label);
    a.__mobileLabel = label;
    a.__mobileIcon = icon || "fa-circle";
    if (extra) Object.keys(extra).forEach(function (key) { a[key] = extra[key]; });
    return a;
  }

  function isActiveSource(el) {
    if (!el) return false;
    if (el.classList && el.classList.contains("active")) return true;

    var href = el.getAttribute("href") || "";
    if (!href || href === "#") return false;
    if (href.charAt(0) === "#") return location.hash === href;

    try {
      var target = new URL(href, location.href);
      var here = new URL(location.href);
      return target.pathname.toLowerCase() === here.pathname.toLowerCase();
    } catch (err) {
      return false;
    }
  }

  function sourceLabel(el) {
    return el.__mobileLabel || labelFor(el);
  }

  function sourceIcon(el) {
    return el.__mobileIcon || iconFor(el, sourceLabel(el));
  }

  function sourceHref(el) {
    return el.getAttribute("href") || "";
  }

  function sourceKey(el) {
    if (!el) return "";
    if (window.NavBadges && typeof window.NavBadges.keyForElement === "function") {
      return window.NavBadges.keyForElement(el) || "";
    }
    return el.getAttribute("data-nav-key") || "";
  }

  function keyAttrs(el) {
    var key = sourceKey(el);
    if (!key) return "";
    return ' data-nav-key="' + escapeHtml(key) + '"';
  }

  function collectSources() {
    var sidebar = Array.prototype.slice.call(document.querySelectorAll(".sidebar-menu a"));
    var header = Array.prototype.slice.call(document.querySelectorAll("header nav a, .main-header nav a"));
    var extras = [];

    var bell = document.querySelector("#notificationBell, #adminNotifBell, #notifBell");
    var logout = document.querySelector('.logout-btn, a[onclick*="handleLogout"]');

    [bell, logout].forEach(function (el) {
      if (el && sidebar.indexOf(el) === -1 && header.indexOf(el) === -1 && extras.indexOf(el) === -1) {
        extras.push(el);
      }
    });

    if (body.classList.contains("customizer-page") || pageName === "boatcust.html") {
      var back = makeVirtual("Back", "home.html", "fa-arrow-left", { __mobileBack: true });
      var home = makeVirtual("Home", "home.html", "fa-house");
      var moreItems = [
        makeVirtual("Order Boat", "order.html", "fa-ship"),
        makeVirtual("Payments", "payment.html", "fa-credit-card"),
        makeVirtual("Profile", "profile.html", "fa-user")
      ];
      if (logout) moreItems.push(logout);
      return { mode: "customizer", primary: [back, home], more: moreItems };
    }

    if (sidebar.length) {
      var ordered = sidebar.slice().sort(function (a, b) {
        return (isActiveSource(b) ? 1 : 0) - (isActiveSource(a) ? 1 : 0);
      });
      var primary = ordered.slice(0, 4);
      var more = ordered.slice(4).concat(extras);
      return { mode: "sidebar", primary: primary, more: more };
    }

    if (header.length) {
      var primaryHeaders = [];
      var used = [];

      CANONICAL.forEach(function (entry) {
        var match = header.filter(function (a) {
          return used.indexOf(a) === -1 && entry.match.test(sourceLabel(a));
        })[0];

        if (match) {
          match.__mobileLabel = entry.label;
          match.__mobileIcon = entry.icon;
          primaryHeaders.push(match);
          used.push(match);
        } else {
          primaryHeaders.push(makeVirtual(entry.label, entry.href, entry.icon));
        }
      });

      var moreHeaders = header.filter(function (a) { return used.indexOf(a) === -1; }).concat(extras);
      return { mode: "customer", primary: primaryHeaders, more: moreHeaders };
    }

    var fallbackPrimary = CANONICAL.map(function (entry) {
      return makeVirtual(entry.label, entry.href, entry.icon);
    });
    return { mode: "customer", primary: fallbackPrimary, more: extras };
  }

  function buildShell() {
    if (bar) return;

    bar = document.createElement("nav");
    bar.className = "mobile-tabbar";
    bar.id = "mobileTabbar";
    bar.setAttribute("aria-label", "Mobile navigation");

    scrim = document.createElement("div");
    scrim.className = "mobile-sheet-scrim";
    scrim.id = "mobileSheetScrim";

    sheet = document.createElement("section");
    sheet.className = "mobile-sheet";
    sheet.id = "mobileSheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "More options");
    sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML =
      '<div class="mobile-sheet-handle" aria-hidden="true"></div>' +
      '<div class="mobile-sheet-head">' +
        '<span>More</span>' +
        '<button type="button" class="mobile-sheet-close" aria-label="Close more options">&times;</button>' +
      '</div>' +
      '<div class="mobile-sheet-list"></div>';

    moreList = sheet.querySelector(".mobile-sheet-list");

    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    document.body.appendChild(bar);

    bar.addEventListener("click", onBarClick);
    moreList.addEventListener("click", onMoreClick);
    scrim.addEventListener("click", closeSheet);
    sheet.querySelector(".mobile-sheet-close").addEventListener("click", closeSheet);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeSheet();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 600) closeSheet();
    });
  }

  function onBarClick(event) {
    var more = event.target.closest("[data-mobile-more]");
    if (more) {
      event.preventDefault();
      toggleSheet();
      return;
    }

    var button = event.target.closest("[data-mobile-index]");
    if (!button) return;
    event.preventDefault();

    closeSheet();
    activate(currentSources[Number(button.getAttribute("data-mobile-index"))]);
  }

  function onMoreClick(event) {
    var button = event.target.closest("[data-mobile-index]");
    if (!button) return;
    event.preventDefault();
    closeSheet();
    activate(currentSources[Number(button.getAttribute("data-mobile-index"))]);
  }

  function activate(source) {
    if (!source) return;
    if (source.__mobileBack && history.length > 1) {
      history.back();
      return;
    }
    source.click();
  }

  function toggleSheet() {
    if (sheet.classList.contains("is-open")) closeSheet();
    else openSheet();
  }

  function openSheet() {
    sheet.classList.add("is-open");
    scrim.classList.add("is-open");
    body.classList.add("mobile-sheet-open");
    sheet.setAttribute("aria-hidden", "false");
    if (moreButton) moreButton.setAttribute("aria-expanded", "true");
    var first = moreList.querySelector("[data-mobile-index]");
    if (first) first.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove("is-open");
    scrim.classList.remove("is-open");
    body.classList.remove("mobile-sheet-open");
    sheet.setAttribute("aria-hidden", "true");
    if (moreButton) moreButton.setAttribute("aria-expanded", "false");
  }

  function tabHtml(source, index, labelOverride) {
    var label = labelOverride || sourceLabel(source);
    var icon = sourceIcon(source);
    var active = isActiveSource(source) ? " is-active" : "";
    return (
      '<button type="button" class="mobile-tab' + active + '" data-mobile-index="' + index + '"' +
      keyAttrs(source) +
      ' aria-label="' + escapeHtml(label) + '">' +
        '<span class="mobile-tab-icon" aria-hidden="true"><i class="fa-solid ' + icon + '"></i></span>' +
        '<span class="mobile-tab-label">' + escapeHtml(label) + '</span>' +
      '</button>'
    );
  }

  function moreHtml(source, index) {
    var label = sourceLabel(source);
    var icon = sourceIcon(source);
    return (
      '<button type="button" class="mobile-sheet-item" data-mobile-index="' + index + '"' +
      keyAttrs(source) + '>' +
        '<span class="mobile-sheet-icon" aria-hidden="true"><i class="fa-solid ' + icon + '"></i></span>' +
        '<span class="mobile-sheet-label">' + escapeHtml(label) + '</span>' +
        '<i class="fa-solid fa-chevron-right mobile-sheet-chevron" aria-hidden="true"></i>' +
      '</button>'
    );
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render(collected) {
    buildShell();

    currentSources = collected.primary.concat(collected.more);
    var primaryCount = collected.primary.length;

    var html = "";
    for (var i = 0; i < primaryCount; i += 1) {
      var label = i === 0 && collected.mode === "customizer" ? "Back" : null;
      html += tabHtml(collected.primary[i], i, label);
    }

    var moreKeys = [];
    for (var k = 0; k < collected.more.length; k += 1) {
      var moreKey = sourceKey(collected.more[k]);
      if (moreKey && moreKeys.indexOf(moreKey) === -1) moreKeys.push(moreKey);
    }

    html +=
      '<button type="button" class="mobile-tab mobile-tab-more" data-mobile-more' +
      (moreKeys.length ? ' data-nav-keys="' + escapeHtml(moreKeys.join(" ")) + '"' : "") +
      ' aria-expanded="false" aria-controls="mobileSheet">' +
        '<span class="mobile-tab-icon" aria-hidden="true"><i class="fa-solid fa-ellipsis"></i></span>' +
        '<span class="mobile-tab-label">More</span>' +
      '</button>';

    bar.innerHTML = html;
    moreButton = bar.querySelector("[data-mobile-more]");

    var moreHtmlString = "";
    for (var j = 0; j < collected.more.length; j += 1) {
      moreHtmlString += moreHtml(collected.more[j], primaryCount + j);
    }
    moreList.innerHTML = moreHtmlString || '<div class="mobile-sheet-empty">No more links</div>';

    body.classList.add("has-mobile-tabbar");
    body.classList.add("mobile-page-" + collected.mode);
  }

  function signatureOf(collected) {
    return collected.primary.concat(collected.more).map(function (el) {
      return sourceLabel(el) + "|" + sourceHref(el) + "|" + sourceKey(el) + "|" + (isActiveSource(el) ? "1" : "0");
    }).join(";;");
  }

  function sync() {
    if (!document.body) return;
    var collected = collectSources();
    var signature = signatureOf(collected);
    if (signature === lastSignature) return;
    lastSignature = signature;
    render(collected);
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 120);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sync);
  } else {
    sync();
  }

  var menu = document.querySelector(".sidebar-menu");
  if (menu && window.MutationObserver) {
    new MutationObserver(scheduleSync).observe(menu, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }
})();
