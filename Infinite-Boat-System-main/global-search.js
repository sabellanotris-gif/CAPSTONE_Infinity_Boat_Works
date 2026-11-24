/* =========================================================
   GLOBAL SEARCH — live suggestion dropdown.
   Admin + manager pages only. Frontend-only: reads the same
   Supabase tables the dashboards already use and hands the
   chosen query to the local search via ?q=
   ========================================================= */
(function () {
  "use strict";

  var DEBOUNCE_MS = 150;
  var MAX_SUGGESTIONS = 8;

  function activeRole() {
    var verified = window.__activeProfile && window.__activeProfile.role;
    return verified || sessionStorage.getItem("role") || "";
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function truncate(value, max) {
    var str = String(value == null ? "" : value);
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
  }

  function roleFromAuth(auth) {
    if (auth && auth.profile && auth.profile.role) return auth.profile.role;
    return activeRole();
  }

  (async function boot() {
    var sb, sh;
    try {
      var loaded = await Promise.all([
        import("./supabase.js"),
        import("./search-helpers.js?v=1")
      ]);
      sb = loaded[0];
      sh = loaded[1];
    } catch (err) {
      return; // Search is an enhancement; never block the page.
    }

    var role = activeRole();
    if (role && role !== "admin" && role !== "manager") return;

    if (!role && typeof window.requireRole === "function") {
      var auth = null;
      try { auth = await window.requireRole(["admin", "manager"]); } catch (err) { auth = null; }
      if (!auth) return;
      role = roleFromAuth(auth);
    }
    if (role !== "admin" && role !== "manager") return;

    mount(sb.supabase, sh, role);
  })();

  function mount(supabase, sh, role) {
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    if (document.getElementById("globalSearch")) return;

    var wrap = el("div", "global-search");
    wrap.id = "globalSearch";

    var inputWrap = el("div", "global-search-input-wrap");
    var icon = el("i");
    icon.className = "fa-solid fa-magnifying-glass";
    var input = el("input", "global-search-input");
    input.type = "text";
    input.id = "globalSearchInput";
    input.placeholder = role === "admin"
      ? "Search customers, orders, boats, phone..."
      : "Search orders, boats, customers, phone...";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", "Global search");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "globalSearchMenu");

    var clear = el("button", "global-search-clear");
    clear.id = "globalSearchClear";
    clear.type = "button";
    clear.setAttribute("aria-label", "Clear search");
    clear.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    inputWrap.appendChild(icon);
    inputWrap.appendChild(input);
    inputWrap.appendChild(clear);

    var menu = el("div", "global-search-menu");
    menu.id = "globalSearchMenu";
    menu.hidden = true;

    wrap.appendChild(inputWrap);
    wrap.appendChild(menu);

    var right = topbar.querySelector(".topbar-right");
    if (!right) {
      right = el("div", "topbar-right");
      Array.prototype.slice.call(topbar.children).forEach(function (child, index) {
        if (index === 0 || child === wrap) return; // keep the title where it is
        right.appendChild(child);
      });
      topbar.appendChild(right);
    }
    right.insertBefore(wrap, right.firstChild);

    var cache = null;
    var activeIndex = -1;
    var items = [];
    var timer = null;
    var requestId = 0;

    function openMenu() {
      menu.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
    function closeMenu() {
      menu.hidden = true;
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }
    function setLoading() {
      openMenu();
      menu.innerHTML = "";
      var state = el("div", "global-search-state");
      var spin = el("i");
      spin.className = "fa-solid fa-circle-notch fa-spin";
      state.appendChild(spin);
      state.appendChild(el("span", "", "Searching…"));
      menu.appendChild(state);
      items = [];
      activeIndex = -1;
    }
    function setEmpty() {
      openMenu();
      menu.innerHTML = "";
      var state = el("div", "global-search-state");
      var mag = el("i");
      mag.className = "fa-solid fa-magnifying-glass";
      state.appendChild(mag);
      state.appendChild(el("span", "", "No matches found"));
      menu.appendChild(state);
      items = [];
      activeIndex = -1;
    }

    function paintSuggestions(query) {
      var results = buildSuggestions(query, cache.orders, cache.customers, sh, role);
      menu.innerHTML = "";
      items = [];
      activeIndex = -1;

      if (!results.length) {
        setEmpty();
        return;
      }

      var heading = el("div", "global-search-heading");
      heading.appendChild(el("span", "", "Suggestions"));
      heading.appendChild(el("span", "", results.length + " found"));
      menu.appendChild(heading);

      results.forEach(function (result) {
        var btn = el("button", "global-search-item");
        btn.type = "button";
        btn.dataset.href = result.href;

        var badge = el("span", "global-search-type global-search-type--" + result.type);
        var badgeIcon = el("i");
        badgeIcon.className = "fa-solid " + (result.type === "customer" ? "fa-user" : "fa-ship");
        badge.appendChild(badgeIcon);

        var text = el("span", "global-search-text");
        text.appendChild(el("span", "global-search-label", result.label));
        text.appendChild(el("span", "global-search-meta", result.meta));

        var go = el("i", "global-search-go fa-solid fa-arrow-right");
        btn.appendChild(badge);
        btn.appendChild(text);
        btn.appendChild(go);
        btn.addEventListener("click", function () {
          window.location.href = btn.dataset.href;
        });
        menu.appendChild(btn);
        items.push(btn);
      });

      var footer = el("div", "global-search-footer");
      var allBtn = el("button", "global-search-item");
      allBtn.type = "button";
      allBtn.dataset.href = "dashorder.html?q=" + encodeURIComponent(query.trim());
      var allIcon = el("span", "global-search-type");
      var ico = el("i");
      ico.className = "fa-solid fa-list";
      allIcon.appendChild(ico);
      var allText = el("span", "global-search-text");
      allText.appendChild(el("span", "global-search-label", 'See all matches for "' + truncate(query.trim(), 34) + '"'));
      allBtn.appendChild(allIcon);
      allBtn.appendChild(allText);
      allBtn.addEventListener("click", function () {
        window.location.href = allBtn.dataset.href;
      });
      footer.appendChild(allBtn);
      var hint = el("div", "", "↑ ↓ to navigate · ↵ to open · esc to close");
      footer.appendChild(hint);
      menu.appendChild(footer);
      items.push(allBtn);
      openMenu();
    }

    function setActive(index) {
      if (!items.length) return;
      activeIndex = (index + items.length) % items.length;
      items.forEach(function (btn, i) {
        btn.classList.toggle("is-active", i === activeIndex);
      });
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }

    async function loadData() {
      if (cache) return cache;
      var orderRes = await supabase
        .from("boat_orders")
        .select("orderId,customerName,customerEmail,customerPhone,customerAddress,boatName,boatType,buildType,status,orderPhase,notes,createdAt,deliveryInfo")
        .order("createdAt", { ascending: false })
        .limit(200);
      var orderRows = (orderRes && orderRes.data) || [];

      var profileRows = [];
      if (role === "admin") {
        var profileRes = await supabase
          .from("profiles")
          .select("id,name,email,phone,role,created_at")
          .limit(200);
        profileRows = (profileRes && profileRes.data) || [];
      }
      cache = buildCustomerIndex(orderRows, profileRows, role);
      return cache;
    }

    async function run(query) {
      var id = ++requestId;
      var value = query.trim();
      wrap.classList.toggle("has-value", Boolean(value));
      if (!value) {
        closeMenu();
        return;
      }
      setLoading();
      try {
        await loadData();
      } catch (err) {
        if (id === requestId) closeMenu();
        return;
      }
      if (id !== requestId) return;
      paintSuggestions(value);
    }

    input.addEventListener("input", function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { run(input.value); }, DEBOUNCE_MS);
    });

    input.addEventListener("focus", function () {
      if (input.value.trim()) run(input.value);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu();
        input.blur();
        return;
      }
      if (menu.hidden || !items.length) {
        if (event.key === "Enter" && input.value.trim()) {
          event.preventDefault();
          window.location.href = "dashorder.html?q=" + encodeURIComponent(input.value.trim());
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(activeIndex - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        var target = activeIndex >= 0 ? items[activeIndex] : items[0];
        if (target) window.location.href = target.dataset.href;
      }
    });

    clear.addEventListener("click", function () {
      window.clearTimeout(timer);
      input.value = "";
      wrap.classList.remove("has-value");
      closeMenu();
      input.focus();
    });

    document.addEventListener("click", function (event) {
      if (!wrap.contains(event.target)) closeMenu();
    });

    /* ---------- data shaping ---------- */
    function buildCustomerIndex(orders, profiles, currentRole) {
      var customers = [];
      var seen = new Set();
      var byEmail = {};

      orders.forEach(function (order) {
        var name = order.customerName || order.customerEmail || "";
        if (!name) return;
        var key = sh.normalize(order.customerEmail || name);
        var entry = byEmail[key];
        if (!entry) {
          entry = {
            name: name,
            email: order.customerEmail || "",
            phone: order.customerPhone || "",
            count: 0,
            latest: order.createdAt || ""
          };
          byEmail[key] = entry;
          customers.push(entry);
        }
        entry.count += 1;
        if ((order.createdAt || "") > entry.latest) entry.latest = order.createdAt || "";
      });

      if (currentRole === "admin") {
        profiles.forEach(function (p) {
          if (p.role && p.role !== "customer" && p.role !== "user") return;
          var name = p.name || p.email || "";
          if (!name) return;
          var key = sh.normalize(p.email || name);
          if (seen.has(key)) return;
          seen.add(key);
          if (!byEmail[key]) {
            var entry = {
              name: name,
              email: p.email || "",
              phone: p.phone || "",
              count: 0,
              latest: p.created_at || ""
            };
            byEmail[key] = entry;
            customers.push(entry);
          }
        });
      }
      return { orders: orders, customers: customers };
    }

    function buildSuggestions(query, orders, customers, helper, currentRole) {
      var terms = helper.toTerms(query);
      if (!terms.length) return [];
      var results = [];

      customers.forEach(function (customer) {
        var text = helper.flatText(
          customer.name,
          customer.email,
          customer.phone,
          String(customer.count)
        );
        if (!helper.matchesQuery(text, query)) return;
        var metaParts = [];
        if (customer.email) metaParts.push(customer.email);
        if (customer.phone) metaParts.push(customer.phone);
        if (customer.count) metaParts.push(customer.count + (customer.count === 1 ? " order" : " orders"));
        results.push({
          type: "customer",
          label: customer.name || customer.email,
          meta: metaParts.join(" · ") || "Customer",
          href: (currentRole === "admin" ? "dashcustomer.html?q=" : "dashorder.html?q=")
            + encodeURIComponent(customer.name || customer.email),
          score: score(text, terms)
        });
      });

      orders.forEach(function (order) {
        var text = helper.searchableOrderText(order);
        if (!helper.matchesQuery(text, query)) return;
        var metaParts = [];
        if (order.customerName) metaParts.push(order.customerName);
        if (order.orderId) metaParts.push(order.orderId);
        if (order.boatType) metaParts.push(order.boatType);
        results.push({
          type: "order",
          label: order.boatName || order.orderId || "Order",
          meta: metaParts.join(" · ") || "Order",
          href: "dashorder.html?q=" + encodeURIComponent(order.orderId || order.customerName || order.boatName || ""),
          score: score(text, terms)
        });
      });

      results.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return 0;
      });
      return results.slice(0, MAX_SUGGESTIONS);
    }

    function score(text, terms) {
      var hay = helperNormalize(text);
      return terms.reduce(function (total, term) {
        if (hay.startsWith(term)) return total + 3;
        if (hay.includes(" " + term)) return total + 2;
        return total + (hay.includes(term) ? 1 : 0);
      }, 0);
    }

    function helperNormalize(value) {
      return String(value == null ? "" : value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    }
  }
})();
