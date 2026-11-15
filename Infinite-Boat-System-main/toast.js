/* =========================================================
   SHARED TOAST
   Exposes window.showToast({ title, text, variant, duration })
   and replaces native alert() with the same glass toast so
   admin / manager / worker / customer pages all match.
========================================================= */

(function () {
  "use strict";

  if (typeof window.showToast === "function") return;

  var VARIANTS = ["success", "warning", "danger", "info"];

  var ICONS = {
    success:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    warning:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9 16H3z"/><path d="M12 9.5v4.5"/><path d="M12 17h.01"/></svg>',
    danger:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
    info:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  };

  var hideTimer = null;

  function loadStyles() {
    if (document.getElementById("appToastStyles")) return;
    var link = document.createElement("link");
    link.id = "appToastStyles";
    link.rel = "stylesheet";
    link.href = "toast.css";
    (document.head || document.documentElement).appendChild(link);
  }

  function getToastEl() {
    var toast = document.getElementById("appToast");
    if (toast) return toast;

    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "app-toast";
    toast.dataset.variant = "success";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML =
      '<span class="toast-icon" aria-hidden="true"></span>' +
      '<div class="toast-copy">' +
      '<strong class="toast-title"></strong>' +
      '<span class="toast-text"></span>' +
      "</div>" +
      '<span class="toast-progress" aria-hidden="true"></span>';

    (document.body || document.documentElement).appendChild(toast);
    return toast;
  }

  var VARIANT_ALIASES = {
    success: "success",
    error: "danger",
    danger: "danger",
    warning: "warning",
    warn: "warning",
    info: "info",
  };

  function normalizeVariant(value, fallback) {
    var key = String(value || "").toLowerCase();
    var mapped = VARIANT_ALIASES[key];
    if (mapped) return mapped;
    return VARIANTS.indexOf(fallback) !== -1 ? fallback : "success";
  }

  // Accepts showToast("Saved") , showToast({ title, text, variant, duration })
  // and the legacy showToast("Saved", "success") signature.
  function showToast(options, legacyVariant) {
    var opts = typeof options === "string" ? { title: options } : options || {};
    var duration = Math.max(600, Number(opts.duration) || 3200);
    var variant = normalizeVariant(
      opts.variant || legacyVariant,
      legacyVariant ? "info" : "success"
    );

    loadStyles();

    var toast = getToastEl();
    var icon = toast.querySelector(".toast-icon");
    var titleEl = toast.querySelector(".toast-title");
    var textEl = toast.querySelector(".toast-text");
    var progress = toast.querySelector(".toast-progress");

    clearTimeout(hideTimer);

    toast.dataset.variant = variant;
    if (icon) icon.innerHTML = ICONS[variant] || ICONS.success;
    if (titleEl) titleEl.textContent = opts.title || "";
    if (textEl) {
      textEl.textContent = opts.text || "";
      textEl.hidden = !opts.text;
    }

    // Replay the enter animation even when the same element is reused.
    toast.classList.remove("show");
    void toast.offsetWidth;

    if (progress) {
      progress.style.animation = "none";
      progress.style.animationDuration = duration + "ms";
      void progress.offsetWidth;
      progress.style.animation = "";
    }

    toast.classList.add("show");

    return new Promise(function (resolve) {
      hideTimer = setTimeout(function () {
        toast.classList.remove("show");
        setTimeout(resolve, 220);
      }, duration);
    });
  }

  window.showToast = showToast;

  // Every legacy alert() now shows the same toast. Variant is inferred from
  // the wording so validation messages (amber), failures (red) and completed
  // actions (green) stay visually distinct.
  window.alert = function (message) {
    var text = String(message == null ? "" : message).trim();
    if (!text) return;

    var danger =
      /(failed|failure|error|unable|cannot|can't|denied|rejected|not found|not available|no order|connection|invalid)/i.test(
        text
      );
    var warning = /(please|must|required|select|wait|not yet|closed|missing)/i.test(text);
    var success =
      /(success|successfully|saved|updated|submitted|created|approved|confirmed|completed|sent|registered|cancelled)/i.test(
        text
      );

    var variant = danger ? "danger" : warning ? "warning" : success ? "success" : "info";

    if (text.length > 64) {
      showToast({ title: "Notice", text: text, variant: variant, duration: 4800 });
    } else {
      showToast({ title: text, variant: variant, duration: 3200 });
    }
  };
})();
