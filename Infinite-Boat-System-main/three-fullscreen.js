/* =========================================================
   3D FULLSCREEN HELPER — reuses the existing boatViewer
   controller. No new renderer, no data changes.
   ========================================================= */
(function () {
  "use strict";

  var state = null;

  function button(cls, action, html, label) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "three-fs-btn " + cls;
    btn.dataset.fsAction = action;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = html;
    return btn;
  }

  function rotateLabel(rotating) {
    return rotating
      ? '<i class="fa-solid fa-pause"></i> Pause 360°'
      : '<i class="fa-solid fa-play"></i> Rotate 360°';
  }

  function updateRotateButton() {
    if (!state) return;
    var btn = state.overlay.querySelector('[data-fs-action="rotate"]');
    if (!btn) return;
    var rotating = false;
    try { rotating = Boolean(state.viewer.isAutoRotating()); } catch (e) {}
    btn.innerHTML = rotateLabel(rotating);
    btn.setAttribute("aria-pressed", rotating ? "true" : "false");
  }

  function zoom(direction) {
    if (!state) return;
    try { state.viewer.zoom(direction); } catch (e) {}
  }

  function onKeyDown(event) {
    if (!state) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeThreeFullscreen();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoom(1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoom(-1);
    }
  }

  function onOverlayClick(event) {
    if (event.target === state.overlay) closeThreeFullscreen();
  }

  function onToolbarClick(event) {
    var btn = event.target.closest("[data-fs-action]");
    if (!btn || !state) return;
    var action = btn.dataset.fsAction;
    if (action === "zoom-in") zoom(1);
    else if (action === "zoom-out") zoom(-1);
    else if (action === "reset") {
      try { state.viewer.reset(); } catch (e) {}
    } else if (action === "rotate") {
      try { state.viewer.toggleAutoRotate(); } catch (e) {}
      updateRotateButton();
    } else if (action === "close") closeThreeFullscreen();
  }

  function openThreeFullscreen(options) {
    if (!options || !options.viewer || !options.mount) return;
    if (state) closeThreeFullscreen();
    if (!options.mount.isConnected) return;

    var overlay = document.createElement("div");
    overlay.className = "three-fs-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Full screen 3D boat preview");

    var header = document.createElement("div");
    header.className = "three-fs-header";
    var title = document.createElement("strong");
    title.className = "three-fs-title";
    title.textContent = options.title || "3D Boat Preview";
    var hint = document.createElement("span");
    hint.className = "three-fs-hint";
    hint.textContent = "Drag to rotate · Scroll or pinch to zoom";
    header.appendChild(title);
    header.appendChild(hint);

    var stage = document.createElement("div");
    stage.className = "three-fs-stage";

    var toolbar = document.createElement("div");
    toolbar.className = "three-fs-toolbar";
    toolbar.appendChild(button("three-fs-btn--ghost", "zoom-out", '<i class="fa-solid fa-minus"></i>', "Zoom out"));
    toolbar.appendChild(button("three-fs-btn--ghost", "zoom-in", '<i class="fa-solid fa-plus"></i>', "Zoom in"));
    toolbar.appendChild(button("three-fs-btn--ghost", "reset", '<i class="fa-solid fa-rotate-left"></i> Reset', "Reset 3D view"));
    toolbar.appendChild(button("three-fs-btn--primary", "rotate", rotateLabel(false), "Toggle 360 rotation"));
    toolbar.appendChild(button("three-fs-btn--close", "close", '<i class="fa-solid fa-xmark"></i> Close', "Close full screen 3D view"));

    overlay.appendChild(header);
    overlay.appendChild(stage);
    overlay.appendChild(toolbar);

    var saved = {
      parent: options.mount.parentNode,
      next: options.mount.nextSibling,
      cssText: options.mount.style.cssText
    };

    stage.appendChild(options.mount);
    options.mount.style.position = "absolute";
    options.mount.style.inset = "0";
    options.mount.style.width = "100%";
    options.mount.style.height = "100%";
    options.mount.style.display = "block";

    document.body.appendChild(overlay);
    document.body.classList.add("three-fs-open");

    state = {
      viewer: options.viewer,
      mount: options.mount,
      overlay: overlay,
      saved: saved
    };

    overlay.addEventListener("click", onOverlayClick);
    toolbar.addEventListener("click", onToolbarClick);
    document.addEventListener("keydown", onKeyDown, true);

    requestAnimationFrame(function () {
      try { options.viewer.resize(); } catch (e) {}
      updateRotateButton();
      var closeBtn = toolbar.querySelector('[data-fs-action="close"]');
      if (closeBtn) closeBtn.focus();
    });
  }

  function closeThreeFullscreen() {
    if (!state) return;
    var current = state;
    state = null;

    document.removeEventListener("keydown", onKeyDown, true);
    try {
      if (current.saved.next && current.saved.next.parentNode === current.saved.parent) {
        current.saved.parent.insertBefore(current.mount, current.saved.next);
      } else {
        current.saved.parent.appendChild(current.mount);
      }
    } catch (e) {
      /* mount may have been removed with a modal; nothing to restore */
    }
    current.mount.style.cssText = current.saved.cssText;
    current.overlay.remove();
    document.body.classList.remove("three-fs-open");

    requestAnimationFrame(function () {
      try { current.viewer.resize(); } catch (e) {}
    });
  }

  window.openThreeFullscreen = openThreeFullscreen;
  window.closeThreeFullscreen = closeThreeFullscreen;
})();
