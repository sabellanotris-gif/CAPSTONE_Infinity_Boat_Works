import {
  createBoatViewer,
  preloadBoatModel,
  captureBoatSnapshot,
} from './boatViewer.js';

let viewer = null;
let viewerContainer = null;
const pendingColors = {};
let autoRotateListener = null;

export let initialized = false;

// Warm the model cache as soon as the customizer module loads. This makes
// the 3D view open instantly and allows the submit-time snapshot to finish
// quickly.
preloadBoatModel();

function notifyAutoRotate(state) {
  try { autoRotateListener?.(state); } catch (e) { /* non-fatal */ }
}

export function setAutoRotateListener(fn) {
  autoRotateListener = typeof fn === 'function' ? fn : null;
}

export function initThreeViewer() {
  const container = document.getElementById('threeViewer');
  if (!container) return;

  if (viewer && viewerContainer === container) {
    viewer.resize();
    return;
  }

  if (viewer) {
    try { viewer.destroy(); } catch (e) { /* non-fatal */ }
    viewer = null;
  }

  viewerContainer = container;
  viewer = createBoatViewer(container, {
    colors: pendingColors,
    autoRotate: false,
    onAutoRotateChange: notifyAutoRotate,
  });
  initialized = true;
}

export function showThreeView(show) {
  const threeDiv = document.getElementById('threeViewer');
  const canvas = document.getElementById('boatCanvas');

  if (show) {
    initThreeViewer();
    if (threeDiv) {
      threeDiv.style.display = 'block';
      threeDiv.style.position = 'absolute';
      threeDiv.style.top = '0';
      threeDiv.style.left = '0';
      threeDiv.style.width = '100%';
      threeDiv.style.height = '100%';
    }
    if (canvas) canvas.style.display = 'none';
    if (viewer) viewer.resize();
  } else {
    if (threeDiv) threeDiv.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
  }
}

function pushColor(slot, hex) {
  pendingColors[slot] = hex;
  if (viewer) viewer.setColors({ [slot]: hex });
}

export function setHullColor(hex) { pushColor('hull', hex); }
export function setBodyColor(hex) { pushColor('body', hex); }
export function setDoorColor(hex) { pushColor('door', hex); }
export function setRoofColor(hex) { pushColor('roof', hex); }
export function setDeckColor(hex) { pushColor('deck', hex); }
export function setFloorColor(hex) { pushColor('floor', hex); }
export function setLowerHullColor(hex) { pushColor('lowerHull', hex); }
export function setRailColor(hex) { pushColor('rail', hex); }

/**
 * Toggle the 360° auto rotation. Returns the new state (true = rotating).
 */
export function rotateThree() {
  if (!viewer) return false;
  return viewer.toggleAutoRotate();
}

export function isThreeAutoRotating() {
  return !!(viewer && viewer.isAutoRotating());
}

export function zoomThree(dir) {
  if (viewer) viewer.zoom(dir);
}

export function resetThree() {
  if (viewer) viewer.reset();
}

/**
 * Capture the 3D boat as a JPEG data URL for the admin dashboard.
 * Falls back to an off-screen render when the viewer was never opened.
 */
export async function captureThreePreview(colors = {}) {
  if (viewer && viewer.isReady()) {
    const shot = viewer.getSnapshot(900, 0.85);
    if (shot) return shot;
  }
  const merged = { ...pendingColors, ...colors };
  return captureBoatSnapshot({ colors: merged });
}
