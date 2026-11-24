import {
  createBoatViewer,
  preloadBoatModel,
  captureBoatSnapshot,
} from './boatViewer.js';

let viewer = null;
let viewerContainer = null;
const pendingColors = {};
const pendingDimensions = { lengthFactor: 1, beamFactor: 1 };
let pendingBackground = null;
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
  const viewerOptions = {
    colors: pendingColors,
    dimensions: pendingDimensions,
    // Open the 3D view already spinning a full 360°, while staying freely
    // orbitable by dragging (the spin pauses during the drag, then resumes).
    autoRotate: true,
    onAutoRotateChange: notifyAutoRotate,
  };
  if (pendingBackground) viewerOptions.background = pendingBackground;
  viewer = createBoatViewer(container, viewerOptions);
  // Replay any name/flag set before the viewer existed.
  if (pendingName) viewer.setName(pendingName.text, pendingName.font, pendingName.color, pendingName.placements);
  if (pendingFlag) viewer.setFlag(pendingFlag.type, pendingFlag.imageDataUrl, pendingFlag.placements);
  initialized = true;
}

// The 3D viewer is the only preview. Calling this on load initialises the
// viewer and makes sure the 360° spin is running (free orbit still works;
// the spin pauses while dragging and resumes after).
export function showThreeView() {
  const threeDiv = document.getElementById('threeViewer');

  initThreeViewer();
  if (viewer && !viewer.isAutoRotating()) viewer.setAutoRotate(true);
  if (threeDiv) {
    threeDiv.style.display = 'block';
    threeDiv.style.position = 'absolute';
    threeDiv.style.top = '0';
    threeDiv.style.left = '0';
    threeDiv.style.width = '100%';
    threeDiv.style.height = '100%';
  }
  if (viewer) viewer.resize();
}

function pushColor(slot, hex) {
  pendingColors[slot] = hex;
  if (viewer) viewer.setColors({ [slot]: hex });
}

/**
 * Stretch the boat horizontally: lengthFactor scales along the length axis,
 * beamFactor along the beam axis (both ~±20% around the designed size).
 */
export function setDimensions(lengthFactor = 1, beamFactor = 1) {
  const lf = Number(lengthFactor);
  const bf = Number(beamFactor);
  pendingDimensions.lengthFactor = Number.isFinite(lf) ? lf : 1;
  pendingDimensions.beamFactor = Number.isFinite(bf) ? bf : 1;
  if (viewer) viewer.setDimensions(pendingDimensions.lengthFactor, pendingDimensions.beamFactor);
}

// Legacy alias: "hull" and "body" both paint the boat's main hull surface.
// Map it to the body slot so the two can never fight over the same material.
export function setHullColor(hex) { pushColor('body', hex); }
export function setBodyColor(hex) { pushColor('body', hex); }
export function setDoorColor(hex) { pushColor('door', hex); }
export function setRoofColor(hex) { pushColor('roof', hex); }
export function setDeckColor(hex) { pushColor('deck', hex); }
export function setFloorColor(hex) { pushColor('floor', hex); }
export function setLowerHullColor(hex) { pushColor('lowerHull', hex); }
export function setRailColor(hex) { pushColor('rail', hex); }

// 3D stage background. Stored before the viewer exists and replayed when the
// viewer is created, so picking a swatch works even before the first frame.
export function setThreeBackground(hex) {
  pendingBackground = hex;
  if (viewer && typeof viewer.setBackground === 'function') viewer.setBackground(hex);
}

// Boat name / flag decals. Safe to call before the viewer exists — the
// values are replayed once the 3D view is initialised.
let pendingName = null;
let pendingFlag = null;

export function setBoatName(text, font, color, placements = []) {
  pendingName = { text, font, color, placements };
  if (viewer) viewer.setName(text, font, color, placements);
}
export function clearBoatName() {
  pendingName = { text: '', font: 'Impact', color: '#ffffff', placements: [] };
  if (viewer) viewer.clearName();
}
export function setBoatFlag(type, imageDataUrl, placements = []) {
  pendingFlag = { type, imageDataUrl, placements };
  if (viewer) viewer.setFlag(type, imageDataUrl, placements);
}
export function clearBoatFlag() {
  pendingFlag = { type: 'none', imageDataUrl: null, placements: [] };
  if (viewer) viewer.clearFlag();
}

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
  if (!viewer) return;
  if (viewer.isAutoRotating()) viewer.setAutoRotate(false);
  viewer.reset();
}

/**
 * Capture the 3D boat as a JPEG data URL for the admin dashboard.
 * Falls back to an off-screen render when the viewer was never opened.
 */
export async function captureThreePreview(colors = {}, dimensions = pendingDimensions, background = null) {
  // The live viewer already carries the chosen background, so its snapshot
  // matches what the customer saw. Only the off-screen fallback needs it.
  if (viewer && viewer.isReady()) {
    const shot = viewer.getSnapshot(900, 0.85);
    if (shot) return shot;
  }
  const merged = { ...pendingColors, ...colors };
  return captureBoatSnapshot({
    colors: merged,
    dimensions,
    background: background || pendingBackground || undefined,
  });
}
