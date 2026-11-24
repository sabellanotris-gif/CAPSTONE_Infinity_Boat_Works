/* =========================================================
   IMAGE FULLSCREEN HELPER — frontend only.
   Opens any [data-image-fullscreen] photo in a zoomable overlay.
   ========================================================= */
(function () {
  "use strict";

  var state = null;
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 4;
  var ZOOM_STEP = 0.25;

  function control(cls, action, html, label) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "image-fs-control " + cls;
    btn.dataset.imageFsAction = action;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = html;
    return btn;
  }

  function applyZoom() {
    if (!state) return;
    state.image.style.transform = "scale(" + state.scale + ")";
    var minus = state.overlay.querySelector('[data-image-fs-action="zoom-out"]');
    var plus = state.overlay.querySelector('[data-image-fs-action="zoom-in"]');
    if (minus) minus.disabled = state.scale <= MIN_ZOOM;
    if (plus) plus.disabled = state.scale >= MAX_ZOOM;
  }

  function zoom(direction) {
    if (!state) return;
    state.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.scale + direction * ZOOM_STEP));
    applyZoom();
  }

  function resetZoom() {
    if (!state) return;
    state.scale = MIN_ZOOM;
    applyZoom();
  }

  function onKeyDown(event) {
    if (!state) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeImageFullscreen();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoom(1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoom(-1);
    } else if (event.key === "0") {
      event.preventDefault();
      resetZoom();
    }
  }

  function onOverlayClick(event) {
    if (!state) return;
    if (event.target === state.overlay || event.target === state.stage) closeImageFullscreen();
  }

  function onToolbarClick(event) {
    var btn = event.target.closest("[data-image-fs-action]");
    if (!btn || !state) return;
    var action = btn.dataset.imageFsAction;
    if (action === "zoom-in") zoom(1);
    else if (action === "zoom-out") zoom(-1);
    else if (action === "reset") resetZoom();
    else if (action === "close") closeImageFullscreen();
  }

  function openImageFullscreen(options) {
    if (!options || !options.src) return;
    if (state) closeImageFullscreen();

    var overlay = document.createElement("div");
    overlay.className = "image-fs-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Full screen photo viewer");

    var header = document.createElement("div");
    header.className = "image-fs-header";
    var title = document.createElement("strong");
    title.className = "image-fs-title";
    title.textContent = options.title || "Photo";
    var hint = document.createElement("span");
    hint.className = "image-fs-hint";
    hint.textContent = "Scroll / pinch or use + − to zoom · Esc to close";
    header.appendChild(title);
    header.appendChild(hint);

    var stage = document.createElement("div");
    stage.className = "image-fs-stage";
    var image = document.createElement("img");
    image.className = "image-fs-image";
    image.alt = options.alt || options.title || "Photo";
    image.src = options.src;
    if (window.boatImageOnError) {
      image.onerror = function () { window.boatImageOnError(this); };
    }
    stage.appendChild(image);

    var toolbar = document.createElement("div");
    toolbar.className = "image-fs-toolbar";
    toolbar.appendChild(control("image-fs-control--ghost", "zoom-out", '<i class="fa-solid fa-minus"></i>', "Zoom out"));
    toolbar.appendChild(control("image-fs-control--ghost", "zoom-in", '<i class="fa-solid fa-plus"></i>', "Zoom in"));
    toolbar.appendChild(control("image-fs-control--ghost", "reset", '<i class="fa-solid fa-rotate-left"></i> Reset', "Reset zoom"));
    toolbar.appendChild(control("image-fs-control--close", "close", '<i class="fa-solid fa-xmark"></i> Close', "Close full screen photo"));

    overlay.appendChild(header);
    overlay.appendChild(stage);
    overlay.appendChild(toolbar);

    state = {
      overlay: overlay,
      stage: stage,
      image: image,
      scale: MIN_ZOOM,
      lastFocused: document.activeElement
    };

    document.body.appendChild(overlay);
    document.body.classList.add("image-fs-open");
    overlay.addEventListener("click", onOverlayClick);
    toolbar.addEventListener("click", onToolbarClick);
    document.addEventListener("keydown", onKeyDown, true);
    applyZoom();

    var closeBtn = toolbar.querySelector('[data-image-fs-action="close"]');
    if (closeBtn) closeBtn.focus();
  }

  function closeImageFullscreen() {
    if (!state) return;
    var current = state;
    state = null;

    document.removeEventListener("keydown", onKeyDown, true);
    current.overlay.remove();
    document.body.classList.remove("image-fs-open");

    if (current.lastFocused && current.lastFocused.isConnected) {
      try { current.lastFocused.focus(); } catch (e) { /* non-fatal */ }
    }
  }

  function onTriggerClick(event) {
    var trigger = event.target.closest("[data-image-fullscreen]");
    if (!trigger) return;
    var img = trigger.querySelector("img");
    var src = trigger.dataset.imageSrc || (img && (img.currentSrc || img.src));
    if (!src) return;
    event.preventDefault();
    openImageFullscreen({
      src: src,
      title: trigger.dataset.imageTitle || img?.alt || "Photo",
      alt: trigger.dataset.imageAlt || img?.alt || "Photo"
    });
  }

  document.addEventListener("click", onTriggerClick);

  window.openImageFullscreen = openImageFullscreen;
  window.closeImageFullscreen = closeImageFullscreen;
})();
