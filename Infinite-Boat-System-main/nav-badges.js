/* =========================================================
   NAV BADGES — red "new since last visit" dots.
   Frontend-only. Reads the existing notifications API and
   reports counts the pages already load. No layout shifts:
   the dot is absolutely positioned inside its nav item.
   ========================================================= */
(function () {
  "use strict";

  var STORAGE_PREFIX = "navBadges:v1:";
  var REFRESH_MS = 60000;
  var DOT_CLASS = "nav-dot";

  var state = {};
  var latest = {};
  var namespaceNow = "";
  var modulePromise = null;
  var renderTimer = null;

  var PAGE_KEYS = {
    "dashboard.html": "dashboard",
    "manager.html": "dashboard",
    "dashsales.html": "sales-report",
    "dashpayment.html": "payments",
    "payment.html": "payments",
    "dashanalytics.html": "analytics",
    "dashorder.html": "orders-list",
    "order.html": "order-boat",
    "boat.html": "order-boat",
    "dashcustomer.html": "customers",
    "dashprogress.html": "boat-progress",
    "dashworkers.html": "workers",
    "delivery.html": "delivery",
    "dashinventory.html": "inventory",
    "dashapproval.html": "approvals",
    "home.html": "home",
    "profile.html": "profile",
    "boatcust.html": "customizer",
    "worker.html": "worker-dashboard"
  };

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function activeRole() {
    var verified = window.__activeProfile && window.__activeProfile.role;
    return verified || safeStorageGet("role") || "";
  }

  function namespace() {
    var user = safeStorageGet("userId") || "";
    var email = safeStorageGet("customerEmail") || "";
    return (activeRole() || "guest") + ":" + (user || email || "anon");
  }

  function storageKey() {
    return STORAGE_PREFIX + namespace();
  }

  function readState() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.keys) return {};
      return parsed.keys;
    } catch (e) {
      return {};
    }
  }

  function writeState() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ version: 1, keys: state }));
    } catch (e) {
      /* storage may be unavailable; the dots simply won't survive a reload */
    }
  }

  function ensureNamespace() {
    var next = namespace();
    if (next === namespaceNow) return;
    namespaceNow = next;
    state = readState();
    latest = {};
  }

  function ensureEntry(key) {
    if (!key) return null;
    ensureNamespace();
    if (!state[key]) {
      state[key] = {
        initialized: false,
        initializedSources: {},
        sources: {},
        seenIds: [],
        count: 0,
        countInitialized: false,
        initializedCounts: {},
        countBaselines: {},
        markedAt: 0
      };
    }
    var entry = state[key];
    if (!entry.sources) entry.sources = {};
    if (!entry.initializedSources) entry.initializedSources = {};
    if (!entry.seenIds) entry.seenIds = [];
    if (!entry.initializedCounts) entry.initializedCounts = {};
    if (!entry.countBaselines) entry.countBaselines = {};
    if (!latest[key]) latest[key] = { ids: [], counts: {} };
    return entry;
  }

  function unique(list) {
    var out = [];
    var seen = Object.create(null);
    (list || []).forEach(function (value) {
      if (value === null || value === undefined || value === "") return;
      var str = String(value);
      if (seen[str]) return;
      seen[str] = 1;
      out.push(str);
    });
    return out;
  }

  function unionOf(sources) {
    var all = [];
    Object.keys(sources || {}).forEach(function (source) {
      all = all.concat(sources[source] || []);
    });
    return unique(all);
  }

  function idFor(item, options) {
    if (typeof options.idOf === "function") return String(options.idOf(item));
    var field = options.idField || "id";
    var value = item && item[field];
    if (value === null || value === undefined || value === "") {
      value = item && (item.orderId || item.paymentId || item.registrationId || item.assignmentId || item.id);
    }
    if (value === null || value === undefined || value === "") {
      try { value = JSON.stringify(item); } catch (e) { value = String(item); }
    }
    return (options.prefix || "") + String(value);
  }

  /* ---------- public state writers ---------- */

  function setBadge(key, count, options) {
    var entry = ensureEntry(key);
    if (!entry) return;
    var value = parseInt(count, 10);
    if (!isFinite(value) || value < 1) value = 1;
    entry.count = Math.max(entry.count || 0, value);
    if (options && options.title) entry.title = String(options.title);
    writeState();
    scheduleRender();
  }

  function clearBadge(key) {
    var entry = ensureEntry(key);
    if (!entry) return;
    entry.count = 0;
    writeState();
    scheduleRender();
  }

  function markSeen(key) {
    var entry = ensureEntry(key);
    if (!entry) return;

    var sources = Object.keys(entry.sources || {});
    if (sources.length) {
      entry.seenIds = unionOf(entry.sources);
      entry.initialized = true;
      sources.forEach(function (source) { entry.initializedSources[source] = true; });
    }

    var counts = (latest[key] && latest[key].counts) || entry.counts || {};
    Object.keys(counts).forEach(function (source) {
      entry.countBaselines[source] = counts[source];
      entry.initializedCounts[source] = true;
    });
    if (Object.keys(counts).length) entry.countInitialized = true;

    entry.count = 0;
    entry.markedAt = Date.now();
    writeState();
    scheduleRender();
  }

  /* Item-based sync. Sources are namespaced so the server notification
     list and a page's local list can both feed the same dot. */
  function syncItems(key, items, options) {
    var entry = ensureEntry(key);
    if (!entry) return 0;
    options = options || {};

    var source = String(options.source || "default");
    var list = Array.isArray(items) ? items : [];
    var ids = unique(list.map(function (item) { return idFor(item, options); }));
    var firstSource = !entry.initializedSources[source];

    entry.sources[source] = ids;
    entry.initializedSources[source] = true;
    latest[key].ids = unionOf(entry.sources);

    if (!entry.initialized) {
      entry.seenIds = unionOf(entry.sources);
      entry.initialized = true;
      entry.count = 0;
    } else if (firstSource) {
      /* A newly connected source is baseline data, not "new activity". */
      entry.seenIds = unique(entry.seenIds.concat(ids));
      var freshAfterBaseline = unionOf(entry.sources).filter(function (id) {
        return entry.seenIds.indexOf(id) === -1;
      });
      entry.count = freshAfterBaseline.length
        ? Math.max(entry.count || 0, freshAfterBaseline.length)
        : 0;
    } else {
      var fresh = latest[key].ids.filter(function (id) {
        return entry.seenIds.indexOf(id) === -1;
      });
      if (fresh.length) entry.count = Math.max(entry.count || 0, fresh.length);
      else entry.count = 0;
    }

    writeState();
    scheduleRender();
    return entry.count || 0;
  }

  /* Fallback for pages that only expose a number, not item ids. */
  function syncCount(key, count, options) {
    var entry = ensureEntry(key);
    if (!entry) return 0;
    options = options || {};

    var value = parseInt(count, 10);
    if (!isFinite(value) || value < 0) value = 0;
    var source = String(options.source || "count");
    var firstSource = !entry.initializedCounts[source];

    entry.counts[source] = value;
    entry.initializedCounts[source] = true;
    if (!latest[key].counts) latest[key].counts = {};
    latest[key].counts[source] = value;

    if (!entry.countInitialized && Object.keys(entry.initializedCounts).length === 1) {
      Object.keys(entry.counts).forEach(function (name) {
        entry.countBaselines[name] = entry.counts[name];
      });
      entry.countInitialized = true;
    } else if (firstSource && entry.countBaselines[source] === undefined) {
      entry.countBaselines[source] = value;
    }

    var delta = 0;
    Object.keys(entry.counts).forEach(function (name) {
      var baseline = entry.countBaselines[name] || 0;
      if (entry.counts[name] > baseline) delta += entry.counts[name] - baseline;
      else entry.countBaselines[name] = entry.counts[name];
    });

    entry.count = delta > 0 ? Math.max(entry.count || 0, delta) : 0;
    writeState();
    scheduleRender();
    return entry.count || 0;
  }

  /* Pages report their data set once it loads. If that page is the section
     being reported, everything currently loaded has just been seen. */
  function report(key, items, options) {
    var result = syncItems(key, items, options);
    if (currentKeys().indexOf(key) !== -1) markSeen(key);
    return result;
  }

  function reportCount(key, count, options) {
    var result = syncCount(key, count, options);
    if (currentKeys().indexOf(key) !== -1) markSeen(key);
    return result;
  }

  function countFor(key) {
    var entry = state[key];
    return entry && entry.count ? entry.count : 0;
  }

  /* ---------- key mapping ---------- */

  function primaryKey(element) {
    if (!element || !element.getAttribute) return "";
    var explicit = element.getAttribute("data-nav-key");
    if (explicit) return explicit;

    var id = element.id || "";
    if (/notif/i.test(id)) return "notifications";

    var href = (element.getAttribute("href") || "").toLowerCase();
    if (href.charAt(0) === "#") {
      if (href.indexOf("project") !== -1) return "projects";
      if (href.indexOf("boat") !== -1 || href.indexOf("order") !== -1) return "order-boat";
      if (href.indexOf("custom") !== -1) return "customizer";
      return "";
    }

    var file = href.split(/[?#]/)[0].split("/").pop();
    if (file === "worker.html") {
      if (href.indexOf("assignments") !== -1) return "assignments";
      if (href.indexOf("profile") !== -1) return "profile";
      return "worker-dashboard";
    }
    return PAGE_KEYS[file] || "";
  }

  function allKeys(element) {
    if (!element || !element.getAttribute) return [];
    var keys = [];
    var primary = element.getAttribute("data-nav-key");
    if (primary) keys.push(primary);
    var extra = element.getAttribute("data-nav-keys");
    if (extra) {
      extra.split(/[\s,]+/).forEach(function (key) {
        if (key) keys.push(key);
      });
    }
    return unique(keys);
  }

  function currentKeys() {
    var file = (location.pathname.split("/").pop() || "").toLowerCase();
    var href = location.href.toLowerCase();
    if (file === "worker.html") {
      if (href.indexOf("assignments") !== -1) return ["assignments"];
      if (href.indexOf("profile") !== -1) return ["profile"];
      return ["worker-dashboard"];
    }
    var key = PAGE_KEYS[file];
    return key ? [key] : [];
  }

  function keysForNotification(notification, role) {
    role = role || activeRole();
    var type = String((notification && notification.type) || "").toLowerCase();
    var text = String(((notification && notification.title) || "") + " " +
      ((notification && notification.message) || "")).toLowerCase();
    var hay = type + " " + text;
    var keys = [];

    function add(key) {
      if (key && keys.indexOf(key) === -1) keys.push(key);
    }

    if (/deliver|delivery|transit|shipping|snag/.test(hay)) add("delivery");
    if (/payment|invoice|receipt|reminder|refund/.test(hay)) add("payments");
    if (/approval|approve|approved|signing|contract|reject/.test(hay)) {
      add(role === "worker" ? "assignments" : "approvals");
    }
    if (/assign|task|progress|milestone|schedule|worker|phase/.test(hay)) {
      add(role === "worker" ? "assignments" : "boat-progress");
    }
    if (role === "customer") {
      if (/order|boat|custom/.test(hay)) add("order-boat");
      else add("home");
    }
    return keys;
  }

  /* ---------- rendering ---------- */

  function directDot(host) {
    for (var i = 0; i < host.children.length; i += 1) {
      if (host.children[i].classList && host.children[i].classList.contains(DOT_CLASS)) {
        return host.children[i];
      }
    }
    return null;
  }

  function updateDot(host, count) {
    var dot = directDot(host);
    if (count > 0) {
      if (!dot) {
        dot = document.createElement("span");
        dot.className = DOT_CLASS;
        dot.setAttribute("aria-hidden", "true");
        host.appendChild(dot);
      }
      dot.hidden = false;
      dot.setAttribute("data-count", String(count));
      host.setAttribute("data-nav-new", String(count));
      if (host.classList) host.classList.add("has-nav-dot");
    } else {
      if (dot) dot.hidden = true;
      host.removeAttribute("data-nav-new");
      if (host.classList) host.classList.remove("has-nav-dot");
    }
  }

  function render() {
    ensureNamespace();
    if (!document.body) return;

    var bells = document.querySelectorAll("#notificationBell, #adminNotifBell, #notifBell");
    Array.prototype.forEach.call(bells, function (bell) {
      if (!bell.getAttribute("data-nav-key")) bell.setAttribute("data-nav-key", "notifications");
    });

    var hosts = document.querySelectorAll("[data-nav-key], [data-nav-keys]");
    Array.prototype.forEach.call(hosts, function (host) {
      var keys = allKeys(host);

      if (host.classList && host.classList.contains("nav-group-btn")) {
        Array.prototype.forEach.call(host.querySelectorAll(".nav-sub [data-nav-key]"), function (child) {
          var childKey = child.getAttribute("data-nav-key");
          if (childKey && keys.indexOf(childKey) === -1) keys.push(childKey);
        });
      }

      var count = 0;
      keys.forEach(function (key) { count += countFor(key); });
      updateDot(host, count);
    });
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () {
      renderTimer = null;
      render();
    }, 0);
  }

  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    if (target.closest("#notificationBell, #adminNotifBell, #notifBell")) {
      markSeen("notifications");
      return;
    }

    var group = target.closest(".nav-group-btn");
    if (group) {
      allKeys(group).forEach(markSeen);
      Array.prototype.forEach.call(group.querySelectorAll("[data-nav-key]"), function (child) {
        markSeen(child.getAttribute("data-nav-key"));
      });
      scheduleRender();
      return;
    }

    var host = target.closest("[data-nav-key]");
    if (host) {
      allKeys(host).forEach(markSeen);
      var parent = host.getAttribute("data-nav-parent");
      if (parent) markSeen(parent);
      scheduleRender();
    }
  }

  /* ---------- notifications API (read-only) ---------- */

  function supabaseModule() {
    if (!modulePromise) modulePromise = import("./supabase.js");
    return modulePromise;
  }

  function refreshNotifications() {
    return supabaseModule().then(function (sb) {
      return sb.supabase.auth.getSession().then(function (result) {
        var token = result && result.data && result.data.session && result.data.session.access_token;
        if (!token) return null;
        return fetch(sb.API_BASE + "/notifications", {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store"
        });
      });
    }).then(function (response) {
      if (!response || !response.ok) return;
      return response.json().then(function (rows) {
        if (!Array.isArray(rows)) return;

        var byKey = {};
        function add(key, notification) {
          if (!key || !notification) return;
          if (!byKey[key]) byKey[key] = [];
          if (byKey[key].indexOf(notification) === -1) byKey[key].push(notification);
        }

        rows.forEach(function (notification) {
          add("notifications", notification);
          keysForNotification(notification).forEach(function (key) { add(key, notification); });
        });

        Object.keys(byKey).forEach(function (key) {
          syncItems(key, byKey[key], {
            source: "server-notifications",
            idOf: function (notification) {
              return "n:" + (notification.id || ((notification.createdAt || "") + "|" + (notification.title || "")));
            }
          });
        });
      });
    }).catch(function () {
      /* Notifications are an enhancement; never break navigation. */
    });
  }

  function boot() {
    ensureNamespace();
    render();
    document.addEventListener("click", onClick, true);

    if (window.MutationObserver) {
      new MutationObserver(scheduleRender).observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    currentKeys().forEach(markSeen);
    refreshNotifications();
    setInterval(refreshNotifications, REFRESH_MS);
  }

  var api = {
    set: setBadge,
    clear: clearBadge,
    markSeen: markSeen,
    render: render,
    syncItems: syncItems,
    syncCount: syncCount,
    report: report,
    reportCount: reportCount,
    keyForElement: primaryKey,
    keysForElement: allKeys,
    currentKeys: currentKeys,
    refreshNotifications: refreshNotifications
  };

  window.NavBadges = api;
  window.navBadges = api;
  window.setNavBadge = function (key, count, options) { setBadge(key, count, options); };
  window.clearNavBadge = function (key) { clearBadge(key); };
  window.markNavSeen = function (key) { markSeen(key); };
  window.renderNavBadges = render;

  namespaceNow = namespace();
  state = readState();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
