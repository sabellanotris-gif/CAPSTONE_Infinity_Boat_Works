import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { drawPhilippineFlag } from './phflag.js';

// Single shared model file so both the customizer and the dashboards
// always show the same boat preview.
const MODEL_URL = new URL('models/final-boat.glb', import.meta.url).href + '?v=2';

let preloaded = false;

/**
 * Warm the browser cache so the 3D view opens quickly and the snapshot
 * taken on submit does not have to wait for a cold download.
 */
export function preloadBoatModel() {
  if (preloaded) return;
  preloaded = true;
  try {
    fetch(MODEL_URL, { cache: 'force-cache' }).catch(() => {});
  } catch (e) { /* non-fatal */ }
}

// Accept either a hex string or the numeric colors used by THREE so callers
// can switch the 3D background without recreating the canvas.
function toBackgroundHex(value) {
  if (typeof value === 'number') {
    return '#' + value.toString(16).padStart(6, '0');
  }
  const text = String(value || '').trim();
  if (/^0x[0-9a-f]{6}$/i.test(text)) return '#' + text.slice(2);
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  return '';
}

function materialsOf(mesh) {
  if (!mesh || !mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function eachMaterial(root, fn) {
  if (!root) return;
  root.traverse((child) => {
    if (!child.isMesh) return;
    materialsOf(child).forEach((mat) => {
      if (mat) fn(mat, child);
    });
  });
}

function matchesColorSlot(slot, matName, mat) {
  switch (slot) {
    case 'hull':
      // The model's main hull surface is the "body" material. Never let the
      // hull slot touch the "Lower Hull Stripe" material, which has its own
      // LOWER HULL COLOR control.
      return (matName.includes('hull') && !matName.includes('lower') && !matName.includes('stripe'))
        || matName.includes('body')
        || matName.includes('tripo_material');
    case 'body':
      return matName.includes('body') || (matName.includes('tripo_material') && !!mat.map);
    case 'door':
      return matName.includes('door');
    case 'roof':
      return matName.includes('roof');
    case 'deck':
    case 'floor':
      return matName.includes('deck') || matName.includes('floor');
    case 'lowerHull':
      return matName.includes('lower') || matName.includes('stripe');
    case 'rail':
      return matName.includes('rail');
    default:
      return false;
  }
}

function applyColorSlot(root, slot, hex) {
  if (!root || !hex) return;
  const color = new THREE.Color(hex);
  eachMaterial(root, (mat) => {
    const name = (mat.name || '').toLowerCase();
    if (!matchesColorSlot(slot, name, mat)) return;
    if (!mat.color) mat.color = new THREE.Color(hex);
    else mat.color.copy(color);
    mat.needsUpdate = true;
  });
}

/**
 * Create an independent boat viewer inside `container`.
 *
 * Returns a small controller:
 *   setColors({ hull, body, door, roof, deck, floor, lowerHull, rail })
 *   setAutoRotate(bool) / toggleAutoRotate() / isAutoRotating()
 *   zoom(dir) / reset() / resize() / getSnapshot() / whenReady()
 *   destroy()
 */
export function createBoatViewer(container, options = {}) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) throw new Error('Boat viewer container not found');

  const opts = {
    modelUrl: MODEL_URL,
    background: 0x87ceeb,
    interactive: true,
    autoRotate: false,
    autoRotateSpeed: 2.0,
    colors: {},
    fallbackWidth: 640,
    fallbackHeight: 420,
    onReady: null,
    onError: null,
    onAutoRotateChange: null,
    onNameTransformChange: null,
    ...options,
  };

  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  let width = el.clientWidth || opts.fallbackWidth;
  let height = el.clientHeight || opts.fallbackHeight;

  const scene = new THREE.Scene();
  const initialBackground = toBackgroundHex(opts.background) || '#87ceeb';
  scene.background = new THREE.Color(initialBackground);
  el.dataset.viewerBackground = initialBackground;

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
  camera.position.set(15, 10, 20);

  // preserveDrawingBuffer is required so we can capture a JPEG preview
  // from the WebGL canvas for the admin dashboard.
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  el.appendChild(renderer.domElement);

  const overlay = document.createElement('div');
  overlay.textContent = 'Loading 3D…';
  overlay.style.cssText = [
    'position:absolute', 'inset:0', 'display:flex', 'align-items:center',
    'justify-content:center', 'background:rgba(255,255,255,.55)',
    'color:#334155', 'font:600 13px Poppins,system-ui,sans-serif',
    'z-index:2', 'pointer-events:none', 'text-align:center', 'padding:12px',
  ].join(';');
  el.appendChild(overlay);

  // Selection UI for direct name manipulation (desktop mouse, Canva-like).
  const nameOverlay = document.createElement('div');
  nameOverlay.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;display:none;';
  const nameBox = document.createElement('div');
  nameBox.style.cssText = 'position:absolute;border:2px solid #2563eb;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.7);pointer-events:auto;cursor:move;box-sizing:border-box;';
  const makeHandle = (pos, cursor) => {
    const h = document.createElement('div');
    const base = 'position:absolute;width:12px;height:12px;background:#fff;border:2px solid #2563eb;border-radius:2px;pointer-events:auto;box-shadow:0 1px 3px rgba(0,0,0,.2);';
    const posCss = {
      nw: 'left:-7px;top:-7px;', ne: 'right:-7px;top:-7px;',
      sw: 'left:-7px;bottom:-7px;', se: 'right:-7px;bottom:-7px;',
    }[pos] || '';
    h.style.cssText = base + posCss + `cursor:${cursor};`;
    h.dataset.handle = pos;
    nameBox.appendChild(h);
    return h;
  };
  const nameHandles = {
    nw: makeHandle('nw', 'nwse-resize'),
    ne: makeHandle('ne', 'nesw-resize'),
    sw: makeHandle('sw', 'nesw-resize'),
    se: makeHandle('se', 'nwse-resize'),
  };
  nameOverlay.appendChild(nameBox);
  el.appendChild(nameOverlay);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = opts.interactive;
  controls.zoomToCursor = false;
  controls.enablePan = false;
  controls.rotateSpeed = 0.5;
  // Full 360° orbit: unlimited horizontal rotation and top-to-bottom
  // vertical rotation so the whole boat (including the underside) is reachable.
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.autoRotateSpeed = opts.autoRotateSpeed;
  controls.enabled = opts.interactive;

  // The wheel is handled by our own capture-phase listener so it behaves
  // exactly like the toolbar Zoom In/Out buttons: instant ×0.85 / ×1.18
  // steps around the boat's center, clamped to min/max distance (the clamp
  // happens inside controls.update()). OrbitControls' built-in wheel
  // handler never sees the event. Pinch-to-zoom stays with OrbitControls.
  const WHEEL_NOTCH = 100;
  let wheelAccum = 0;

  function dollyCamera(dir) {
    const scale = dir > 0 ? 0.85 : 1.18;
    camera.position.sub(controls.target);
    camera.position.multiplyScalar(scale);
    camera.position.add(controls.target);
    controls.update();
  }

  if (opts.interactive) {
    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      event.stopPropagation();
      wheelAccum += event.deltaY;
      const steps = Math.floor(Math.abs(wheelAccum) / WHEEL_NOTCH);
      const dir = wheelAccum < 0 ? 1 : -1; // scroll up = zoom in
      for (let i = 0; i < steps; i++) dollyCamera(dir);
      wheelAccum -= Math.sign(wheelAccum) * WHEEL_NOTCH * steps;
    }, { capture: true, passive: false });
  }

  let autoRotating = !!opts.autoRotate;
  controls.autoRotate = autoRotating;

  function emitAutoRotate() {
    try { opts.onAutoRotateChange?.(autoRotating); } catch (e) { /* non-fatal */ }
  }

  function setAutoRotate(on) {
    autoRotating = !!on;
    controls.autoRotate = autoRotating;
    emitAutoRotate();
  }

  // Report the initial state so the caller's button starts on the right label.
  if (autoRotating) emitAutoRotate();

  // While the user drags, OrbitControls pauses auto-rotation on its own and
  // resumes it on release, so dragging always works even during a 360° spin.

  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(10, 20, 10);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
  fillLight.position.set(-10, 15, -10);
  scene.add(fillLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  let model = null;
  let ready = false;
  let destroyed = false;
  let frameId = 0;

  // Horizontal (length/beam) stretch state. The base model is normalized to
  // a fixed size on load; the configured dimensions scale it along two axes.
  let baseScale = 1;
  let lengthAxis = 'z';
  let beamAxis = 'x';
  const pendingDimensions = { lengthFactor: 1, beamFactor: 1 };
  const targetScale = new THREE.Vector3(1, 1, 1);

  if (opts.dimensions) {
    const lf = Number(opts.dimensions.lengthFactor);
    const bf = Number(opts.dimensions.beamFactor);
    if (Number.isFinite(lf)) pendingDimensions.lengthFactor = Math.min(1.5, Math.max(0.5, lf));
    if (Number.isFinite(bf)) pendingDimensions.beamFactor = Math.min(1.5, Math.max(0.5, bf));
  }

  function applyDimensionFactors(snap = false) {
    if (!model) return;
    const lf = pendingDimensions.lengthFactor;
    const bf = pendingDimensions.beamFactor;
    const sx = beamAxis === 'x' ? baseScale * bf : baseScale * lf;
    const sz = beamAxis === 'z' ? baseScale * bf : baseScale * lf;
    targetScale.set(sx, baseScale, sz);
    if (snap) model.scale.copy(targetScale);
  }

  const pendingColors = {};
  Object.keys(opts.colors || {}).forEach((key) => {
    if (opts.colors[key]) pendingColors[key] = opts.colors[key];
  });

  // ── Boat name / flag decals ──────────────────────────────────────
  // Name and flag artwork is projected onto the hull via DecalGeometry
  // (hugs the curved surface like real vinyl wrap) using Blender anchor
  // empties (Anchor_Name_* / Anchor_Flag_*) or a smart local-bbox fallback.
  // Sides and bow project; the tapered transom uses the flat plane.
  // Decals live at scene level and are re-projected whenever the model's
  // dimensions finish easing, so they stay glued to the hull while stretching.
  let localBox = null;
  // Model-local Y bounds for name lettering: bottom = top of the lower hull
  // stripe, top = top of the painted hull body (just under the rails/roof).
  let lowerHullTopY = null;
  let hullSideTopY = null;
  const NAME_SIZE_MIN = 0.6;
  const NAME_SIZE_MAX = 4.0;
  const anchors = {}; // scene-local anchor transforms captured at load
  let nameGroup = null;
  let flagGroup = null;
  let pendingName = null;
  let pendingFlag = null;
  let decalRebuildPending = false; // set when dimensions change; decals are re-snapped once the ease settles
  let nameSelected = false;
  let nameDrag = null; // { mode: 'move'|'resize', ... }
  let nameDragRaf = 0;
  let nameDragPending = null;
  let nameHitMesh = null;
  let namePoseLocal = null;
  const nameRaycaster = new THREE.Raycaster();

  function makeTextTexture(text, font, color) {
    const fontPx = 96;
    const pad = 24;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `800 ${fontPx}px ${font}`;
    const w = Math.min(1024, Math.ceil(measure.measureText(text).width) + pad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, 128);
    ctx.font = `800 ${fontPx}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, w / 2, 66);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, 66);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return { texture: tex, aspect: w / 128 };
  }

  function makeImageTexture(source) {
    // Source can be a data URL string or an HTMLImageElement-ready canvas.
    const canvas = document.createElement('canvas');
    canvas.width = source.width || 256;
    canvas.height = source.height || 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return { texture: tex, aspect: canvas.width / canvas.height };
  }

  function loadImageTexture(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Normalize to a bounded canvas so huge uploads stay cheap.
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(makeImageTexture(canvas));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function loadPHFlagTexture(widthPx, heightPx) {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    drawPhilippineFlag(canvas.getContext('2d'), widthPx, heightPx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return { texture: tex, aspect: widthPx / heightPx };
  }

  function decalMaterial(map) {
    return new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      side: THREE.DoubleSide,
    });
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const mat = child.material;
      if (mat?.map) mat.map.dispose();
      mat?.dispose();
    });
    group.parent?.remove(group);
  }

  // Shared placement computation for name/flag decals in LOCAL model space.
  // Returns the un-clamped plane size (pw/ph) and the pose (pos/quat) where
  // the decal should sit, using Blender anchor empties when available.
  function computeDecalPose(textureAspect, part, opts = {}) {
    const la = lengthAxis, bm = beamAxis;
    const size = localBox.getSize(new THREE.Vector3());
    const center = localBox.getCenter(new THREE.Vector3());
    const lenSize = la === 'x' ? size.x : size.z;
    const beamSize = bm === 'x' ? size.x : size.z;
    const isStern = part.startsWith('stern');
    // Name-only options: default above lower hull, but user can place freely.
    const minBottomY = opts.minBottomY;
    const maxTopY = opts.maxTopY;
    const nameAnchored = Number.isFinite(minBottomY) && Number.isFinite(maxTopY);
    const textScale = nameAnchored
      ? Math.min(NAME_SIZE_MAX, Math.max(NAME_SIZE_MIN, opts.sizeScale ?? 1))
      : 1;
    const maxW = (isStern ? beamSize * 0.72 : lenSize * (nameAnchored ? 0.72 : 0.42)) * textScale;
    const maxH = size.y * (nameAnchored ? 0.22 : (isStern ? 0.2 : 0.15)) * textScale;
    let ph = maxH;
    let pw = ph * textureAspect;
    if (pw > maxW) {
      pw = maxW;
      ph = pw / textureAspect;
    }
    let y = center.y + (opts.yLift ?? 0);
    if (nameAnchored) {
      const maxPh = Math.max(0.01, maxTopY - minBottomY);
      if (ph > maxPh) {
        ph = maxPh;
        pw = ph * textureAspect;
      }
      const defaultBottom = Number.isFinite(opts.defaultBottomY) ? opts.defaultBottomY : minBottomY;
      const defaultY = defaultBottom + ph / 2;
      y = Number.isFinite(opts.y) ? opts.y : defaultY;
      const minY = minBottomY + ph / 2;
      const maxY = maxTopY - ph / 2;
      y = Math.min(maxY, Math.max(minY, y));
    }

    // Exact placement wins: use Blender anchor empties when available.
    // 'around' decals ignore anchors so the slider stays continuous.
    const anchor = part === 'around' ? null : (opts.anchor ? anchors[opts.anchor] : null);
    if (anchor) {
      const pos = anchor.position.clone();
      if (nameAnchored) pos.y = y;
      return { pos, quat: anchor.quaternion.clone(), pw, ph, scale: anchor.scale || 1 };
    }

    const offset = Math.max(size.x, size.y, size.z) * 0.004 + 0.002;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const e = new THREE.Euler();

    if (part === 'around') {
      // One decal travelling around the hull: 0% starboard midship,
      // 25% bow, 50% port, 75% stern, all at the same height.
      const angle = Math.min(1, Math.max(0, opts.position ?? 0)) * Math.PI * 2;
      const laRadius = lenSize * 0.45;
      const bmRadius = beamSize * 0.47;
      const laPos = center[la] + laRadius * Math.sin(angle);
      const bmPos = center[bm] + bmRadius * Math.cos(angle);
      if (la === 'x') pos.set(laPos, y, bmPos);
      else pos.set(bmPos, y, laPos);

      // Outward normal of the horizontal ellipse in model axes.
      const nLa = Math.sin(angle) / laRadius;
      const nBm = Math.cos(angle) / bmRadius;
      const outward = new THREE.Vector3();
      if (la === 'x') outward.set(nLa, 0, nBm);
      else outward.set(nBm, 0, nLa);
      outward.normalize();
      // Z = outward, Y = up, X = up × Z keeps lettering readable from
      // outside at every angle (including the port side).
      const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
      const yAxis = new THREE.Vector3().crossVectors(outward, xAxis).normalize();
      quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, outward));
      pos.addScaledVector(outward, offset);
    } else if (part === 'side' || part === 'side-flag') {
      const side = opts.side ?? 1; // +1 or -1 along beam axis
      const bmPos = (side > 0 ? localBox.max[bm] + offset : localBox.min[bm] - offset);
      if (la === 'x') pos.set(center.x, y, bmPos);
      else pos.set(bmPos, y, center.z);
      const rot = bm === 'z'
        ? (side > 0 ? 0 : Math.PI)                        // faces ±z
        : (side > 0 ? Math.PI / 2 : -Math.PI / 2);        // faces ±x
      quat.setFromEuler(e.set(0, rot, 0));
    } else if (isStern) {
      const stPos = localBox.min[la] - offset;
      if (la === 'x') pos.set(stPos, y, center.z);
      else pos.set(center.x, y, stPos);
      quat.setFromEuler(e.set(0, la === 'x' ? -Math.PI / 2 : Math.PI, 0));
    } else { // bow flanks — aimed at a point ahead of and outboard of the bow
      const bowLa = localBox.max[la] - lenSize * 0.16;
      const side = opts.side ?? 1;
      const beamPos = (side > 0 ? localBox.max[bm] : localBox.min[bm]) * 0.78;
      if (la === 'x') pos.set(bowLa, y, beamPos);
      else pos.set(beamPos, y, bowLa);
      const ahead = localBox.max[la] + lenSize * 0.6;
      const outward = beamPos * 1.9;
      const target = new THREE.Vector3();
      if (la === 'x') target.set(ahead, y, outward);
      else target.set(outward, y, ahead);
      const dummy = new THREE.Object3D();
      dummy.position.copy(pos);
      dummy.lookAt(target);
      quat.copy(dummy.quaternion);
    }
    return { pos, quat, pw, ph, scale: 1 };
  }

  // Local → world pose. Decals are scene-level so they can be re-projected
  // (re-snapped to the hull) whenever the model's dimensions change.
  function poseToWorld(pose) {
    model.updateMatrixWorld(true);
    const p = model.localToWorld(pose.pos.clone());
    const q = model.getWorldQuaternion(new THREE.Quaternion()).multiply(pose.quat);
    return { p, q };
  }

  function findHullMesh() {
    let hull = null;
    model.traverse((c) => {
      if (hull || !c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      if (mats.some((m) => m && String(m.name || '').toLowerCase().includes('body'))) hull = c;
    });
    return hull;
  }

  // Read the stripe's upper edge from the model itself so the name always
  // lands on the boundary between the lower hull and the painted hull.
  // Returns a model-local Y, independent of the centering/scale applied later.
  function captureLowerHullTopY() {
    model.updateMatrixWorld(true);
    const invModel = model.matrixWorld.clone().invert();
    let top = null;
    model.traverse((obj) => {
      if (top !== null || !obj.isMesh) return;
      const isLowerHull = materialsOf(obj).some((mat) => {
        const name = (mat && mat.name || '').toLowerCase();
        return name.includes('lower') || name.includes('stripe');
      });
      if (!isLowerHull) return;
      const positions = obj.geometry && obj.geometry.getAttribute('position');
      if (!positions) return;
      const box = new THREE.Box3().setFromBufferAttribute(positions);
      box.applyMatrix4(obj.matrixWorld.clone().premultiply(invModel));
      top = box.max.y;
    });
    return top;
  }

  // Upper bound for name lettering: the top of the body mesh in model space.
  function captureHullSideTopY() {
    const hull = findHullMesh();
    const positions = hull && hull.geometry && hull.geometry.getAttribute('position');
    if (!positions) return null;
    model.updateMatrixWorld(true);
    const invModel = model.matrixWorld.clone().invert();
    const box = new THREE.Box3().setFromBufferAttribute(positions);
    box.applyMatrix4(hull.matrixWorld.clone().premultiply(invModel));
    return box.max.y;
  }

  // Build ONE decal from a texture: projected onto the hull via
  // DecalGeometry so the artwork hugs the curved surface like real vinyl,
  // with a flat-plane fallback when projection can't be built.
  function addDecalPlane(group, texture, aspect, part, opts = {}) {
    const pose = computeDecalPose(aspect, part, opts);
    const size = localBox.getSize(new THREE.Vector3());
    // For around-hull name, snap the plane to the actual hull surface so it
    // never ends up inside the body mesh (which made it invisible).
    if (part === 'around') {
      const hull = findHullMesh();
      if (hull) {
        model.updateMatrixWorld(true);
        const outwardLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quat).normalize();
        const outwardWorld = outwardLocal.clone().transformDirection(model.matrixWorld);
        const originLocal = pose.pos.clone().addScaledVector(outwardLocal, -Math.max(size.x, size.y, size.z));
        const originWorld = model.localToWorld(originLocal.clone());
        nameRaycaster.set(originWorld, outwardWorld);
        const hits = nameRaycaster.intersectObject(hull, true);
        if (hits.length) {
          const hit = hits[hits.length - 1]; // outermost intersection
          // Keep text outside hull; preserve fixed Y band.
          const push = Math.max(0.035, size.y * 0.015);
          const hitLocal = model.worldToLocal(hit.point.clone());
          pose.pos.x = hitLocal.x + outwardLocal.x * push;
          pose.pos.z = hitLocal.z + outwardLocal.z * push;
          // keep pose.pos.y from computeDecalPose (fixed above lower hull)
        } else {
          pose.pos.addScaledVector(outwardLocal, Math.max(0.035, size.y * 0.015));
        }
      } else {
        const outwardLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quat).normalize();
        pose.pos.addScaledVector(outwardLocal, size.y * 0.015);
      }
    }
    const { p, q } = poseToWorld(pose);
    const decalW = pose.pw * (pose.scale || 1);
    const decalH = pose.ph * (pose.scale || 1);

    // Project decals onto the hull so they stick to the 3D surface.
    // Stern uses a flat plane fallback because the transom is tapered.
    // During drag preview we skip projection for responsiveness.
    const wantProject = !part.startsWith('stern') && opts.projected !== false;
    const hull = wantProject ? findHullMesh() : null;
    if (hull) {
      const depth = Math.max(size.x, size.y, size.z) * 0.9 + 0.5;
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      try {
        const geo = new DecalGeometry(hull, p, e, new THREE.Vector3(decalW, decalH, depth));
        if (geo && geo.getAttribute('position') && geo.getAttribute('position').count > 0) {
          const mesh = new THREE.Mesh(geo, decalMaterial(texture));
          mesh.renderOrder = 6;
          mesh.frustumCulled = false;
          mesh.userData.decalPose = pose;
          group.add(mesh);
          return mesh;
        }
        geo.dispose();
      } catch (err) {
        console.warn('[boatViewer] DecalGeometry projection failed, using plane fallback:', err);
      }
    }

    const geo = new THREE.PlaneGeometry(decalW, decalH);
    const mesh = new THREE.Mesh(geo, decalMaterial(texture));
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    mesh.position.copy(p);
    mesh.quaternion.copy(q);
    mesh.userData.decalPose = pose;
    group.add(mesh);
    return mesh;
  }

  function cloneTexture(texture) {
    const t = texture.clone();
    t.needsUpdate = true;
    return t;
  }

  function buildNameGroup({ text, font, color, sizeScale = 1, position = 0, y = null, projected = true }) {
    const group = new THREE.Group();
    const clean = (text || '').trim().toUpperCase();
    if (!clean || !localBox) return group;
    const { texture, aspect } = makeTextTexture(clean, font, color);
    const size = localBox.getSize(new THREE.Vector3());
    // Default above lower hull, but allow placing lower if user drags there.
    const defaultBottomY = lowerHullTopY + size.y * 0.012;
    let minBottomY = localBox.min.y + size.y * 0.01;
    let maxTopY = Number.isFinite(hullSideTopY)
      ? hullSideTopY - size.y * 0.01
      : localBox.max.y - size.y * 0.02;
    if (maxTopY <= minBottomY + size.y * 0.04) {
      maxTopY = minBottomY + size.y * 0.3;
    }
    const mesh = addDecalPlane(group, texture, aspect, 'around', {
      minBottomY, maxTopY, defaultBottomY, sizeScale, position, y, projected,
    });
    namePoseLocal = mesh?.userData?.decalPose || null;
    nameHitMesh = mesh || null;
    // Invisible, slightly larger hit target makes selection easier.
    if (namePoseLocal) {
      const { p, q } = poseToWorld(namePoseLocal);
      const hit = new THREE.Mesh(
        new THREE.PlaneGeometry(namePoseLocal.pw * 1.08, namePoseLocal.ph * 1.25),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      hit.position.copy(p);
      hit.quaternion.copy(q);
      hit.userData.nameHit = true;
      group.add(hit);
      nameHitMesh = hit;
    }
    return group;
  }

  function buildFlagGroup({ type, imageDataUrl, placements }) {
    const group = new THREE.Group();
    if (!localBox || (type !== 'ph' && !imageDataUrl)) return Promise.resolve(group);
    const size = localBox.getSize(new THREE.Vector3());
    // Flag is placed lower than the name so both can coexist on the hull.
    const yLiftSides = size.y * -0.075;
    const yLiftStern = size.y * -0.16;

    const buildWith = (texInfo) => {
      if (!texInfo || !texInfo.texture) return;
      if (placements.includes('sides')) {
        [1, -1].forEach((side) => {
          addDecalPlane(group, cloneTexture(texInfo.texture), texInfo.aspect, 'side-flag', {
            side,
            yLift: yLiftSides,
            anchor: side > 0 ? 'flag_sider' : 'flag_sidel',
          });
        });
      }
      if (placements.includes('stern')) {
        addDecalPlane(group, cloneTexture(texInfo.texture), texInfo.aspect, 'stern-flag', { yLift: yLiftStern, anchor: 'flag_stern' });
      }
    };

    if (type === 'ph') {
      buildWith(loadPHFlagTexture(512, 256));
      return Promise.resolve(group);
    }
    return loadImageTexture(imageDataUrl).then((texInfo) => {
      buildWith(texInfo);
      return group;
    });
  }

  function applyPendingDecals() {
    if (pendingName) applyNameDecal(pendingName);
    if (pendingFlag) applyFlagDecal(pendingFlag);
  }

  function applyNameDecal({ text, font, color, placements = [], sizeScale = 1, position = 0, y = null, projected = true } = {}) {
    pendingName = { text, font, color, placements, sizeScale, position, y };
    if (!model || !localBox) return;
    disposeGroup(nameGroup);
    nameGroup = null;
    nameHitMesh = null;
    namePoseLocal = null;
    nameGroup = buildNameGroup({ ...pendingName, projected });
    scene.add(nameGroup);
    const hasText = !!String(text || '').trim();
    if (!hasText) setNameSelection(false);
    else if (!nameSelected) setNameSelection(true);
    updateNameOverlay();
  }

  function isNameActive() {
    return !!(pendingName && String(pendingName.text || '').trim() && localBox && namePoseLocal);
  }

  function notifyNameTransform() {
    if (!pendingName) return;
    try {
      opts.onNameTransformChange?.({
        sizeScale: pendingName.sizeScale ?? 1,
        position: pendingName.position ?? 0,
        y: pendingName.y ?? null,
      });
    } catch (e) { /* non-fatal */ }
  }

  function setNameSelection(on) {
    nameSelected = !!(on && isNameActive());
    nameOverlay.style.display = nameSelected ? 'block' : 'none';
    if (!nameSelected) nameDrag = null;
  }

  function updateNameOverlay() {
    if (!nameSelected || !isNameActive() || !namePoseLocal) {
      nameOverlay.style.display = 'none';
      return;
    }
    nameOverlay.style.display = 'block';
    const pose = namePoseLocal;
    const hw = pose.pw / 2;
    const hh = pose.ph / 2;
    const corners = [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
    ].map((v) => v.applyQuaternion(pose.quat).add(pose.pos));
    model.updateMatrixWorld(true);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let behind = false;
    corners.forEach((c) => {
      const world = model.localToWorld(c.clone());
      const cam = world.clone().applyMatrix4(camera.matrixWorldInverse);
      if (cam.z > -0.01) { behind = true; return; }
      const w = world.project(camera);
      const x = (w.x * 0.5 + 0.5) * width;
      const y = (-w.y * 0.5 + 0.5) * height;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    if (behind || !Number.isFinite(minX)) { nameOverlay.style.display = 'none'; return; }
    const pad = 4;
    nameBox.style.left = (minX - pad) + 'px';
    nameBox.style.top = (minY - pad) + 'px';
    nameBox.style.width = Math.max(24, maxX - minX + pad * 2) + 'px';
    nameBox.style.height = Math.max(16, maxY - minY + pad * 2) + 'px';
  }

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
  }

  function nameWorldPosAtAngle(t) {
    const center = localBox.getCenter(new THREE.Vector3());
    const y = namePoseLocal?.pos?.y ?? (lowerHullTopY + (localBox.getSize(new THREE.Vector3()).y * 0.08));
    const lenSize = lengthAxis === 'x' ? localBox.getSize(new THREE.Vector3()).x : localBox.getSize(new THREE.Vector3()).z;
    const beamSize = beamAxis === 'x' ? localBox.getSize(new THREE.Vector3()).x : localBox.getSize(new THREE.Vector3()).z;
    const angle = t * Math.PI * 2;
    const laPos = center[lengthAxis] + lenSize * 0.45 * Math.sin(angle);
    const bmPos = center[beamAxis] + beamSize * 0.47 * Math.cos(angle);
    const pos = new THREE.Vector3();
    if (lengthAxis === 'x') pos.set(laPos, y, bmPos);
    else pos.set(bmPos, y, laPos);
    return model.localToWorld(pos);
  }

  function screenPxPerAngle(t) {
    if (!model || !localBox) return width * 0.8;
    model.updateMatrixWorld(true);
    const eps = 0.002;
    const p0 = nameWorldPosAtAngle(t).project(camera);
    const p1 = nameWorldPosAtAngle(t + eps).project(camera);
    const dx = (p1.x - p0.x) * 0.5 * width;
    const dy = (p1.y - p0.y) * -0.5 * height;
    const len = Math.sqrt(dx * dx + dy * dy) / eps;
    return Number.isFinite(len) && len > 10 ? len : width * 0.8;
  }

  function nameAngleFromEvent(event) {
    if (!model || !localBox) return pendingName?.position ?? 0;
    nameRaycaster.setFromCamera(pointerNdc(event), camera);
    const center = localBox.getCenter(new THREE.Vector3());
    const worldY = model.localToWorld(new THREE.Vector3(center.x, namePoseLocal?.pos?.y ?? center.y, center.z)).y;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -worldY);
    const hit = new THREE.Vector3();
    if (!nameRaycaster.ray.intersectPlane(plane, hit)) return pendingName?.position ?? 0;
    model.updateMatrixWorld(true);
    const local = model.worldToLocal(hit.clone());
    const la = lengthAxis, bm = beamAxis;
    const angle = Math.atan2(local[la] - center[la], local[bm] - center[bm]);
    let t = angle / (Math.PI * 2);
    t -= Math.floor(t);
    return t;
  }

  function pickName(event) {
    if (!isNameActive() || !nameHitMesh) return false;
    nameRaycaster.setFromCamera(pointerNdc(event), camera);
    const hits = nameRaycaster.intersectObject(nameHitMesh, false);
    return hits.length > 0;
  }

  function onNamePointerDown(event) {
    if (!opts.interactive || event.button !== 0) return;
    const handleEl = event.target.closest?.('[data-handle]');
    if (handleEl && nameBox.contains(handleEl)) {
      if (!isNameActive()) return;
      event.preventDefault();
      event.stopPropagation();
      controls.enabled = false;
      nameDrag = {
        mode: 'resize',
        handle: handleEl.dataset.handle || 'se',
        startX: event.clientX,
        startY: event.clientY,
        startScale: pendingName?.sizeScale ?? 1,
      };
      setNameSelection(true);
      return;
    }
    if (event.target === nameBox || nameBox.contains(event.target)) {
      if (!isNameActive()) return;
      event.preventDefault();
      event.stopPropagation();
      controls.enabled = false;
      nameDrag = {
        mode: 'move',
        startX: event.clientX,
        startY: event.clientY,
        startPos: pendingName?.position ?? 0,
      };
      setNameSelection(true);
      return;
    }
    if (pickName(event)) {
      event.preventDefault();
      event.stopPropagation();
      controls.enabled = false;
      nameDrag = {
        mode: 'move',
        startX: event.clientX,
        startY: event.clientY,
        startPos: pendingName?.position ?? 0,
      };
      setNameSelection(true);
      return;
    }
    if (nameSelected) setNameSelection(false);
  }

  function scheduleNameDragApply() {
    if (nameDragRaf) return;
    nameDragRaf = requestAnimationFrame(() => {
      nameDragRaf = 0;
      if (!nameDragPending || !pendingName) return;
      applyNameDecal({ ...pendingName, ...nameDragPending, projected: false });
      notifyNameTransform();
    });
  }

  function onNamePointerMove(event) {
    if (!nameDrag || !pendingName) return;
    event.preventDefault();
    if (nameDrag.mode === 'move') {
      model.updateMatrixWorld(true);
      nameRaycaster.setFromCamera(pointerNdc(event), camera);
      const hits = nameRaycaster.intersectObject(model, true);
      let pos = pendingName?.position ?? 0;
      let y = pendingName?.y ?? null;
      if (hits.length) {
        const local = model.worldToLocal(hits[0].point.clone());
        const center = localBox.getCenter(new THREE.Vector3());
        const la = lengthAxis, bm = beamAxis;
        const angle = Math.atan2(local[la] - center[la], local[bm] - center[bm]);
        pos = angle / (Math.PI * 2);
        pos -= Math.floor(pos);
        y = local.y;
      } else {
        // Fallback: screen-tangent drag
        const startPos = nameDrag.startPos ?? pendingName?.position ?? 0;
        const eps = 0.002;
        const p0 = nameWorldPosAtAngle(startPos).project(camera);
        const p1 = nameWorldPosAtAngle(startPos + eps).project(camera);
        const tdx = (p1.x - p0.x) * 0.5 * width;
        const tdy = (p1.y - p0.y) * -0.5 * height;
        const pxPerUnit = Math.sqrt(tdx * tdx + tdy * tdy) / eps;
        if (Number.isFinite(pxPerUnit) && pxPerUnit > 10) {
          const ndx = tdx / (pxPerUnit * eps);
          const ndy = tdy / (pxPerUnit * eps);
          const pdx = event.clientX - nameDrag.startX;
          const pdy = event.clientY - nameDrag.startY;
          pos = startPos + (pdx * ndx + pdy * ndy) / pxPerUnit;
          pos -= Math.floor(pos);
        }
      }
      nameDragPending = { position: pos, y };
    } else if (nameDrag.mode === 'resize') {
      const dx = event.clientX - nameDrag.startX;
      const dy = event.clientY - nameDrag.startY;
      const h = nameDrag.handle || 'se';
      // Corner behavior: dragging outward grows, inward shrinks.
      const sx = h.includes('e') ? dx : -dx;
      const sy = h.includes('s') ? dy : -dy;
      const delta = (sx + sy) / 260;
      const scale = Math.min(NAME_SIZE_MAX, Math.max(NAME_SIZE_MIN, nameDrag.startScale + delta));
      nameDragPending = { sizeScale: scale };
    }
    scheduleNameDragApply();
  }

  function onNamePointerUp() {
    if (!nameDrag) return;
    if (nameDragRaf) { cancelAnimationFrame(nameDragRaf); nameDragRaf = 0; }
    const finalState = nameDragPending;
    nameDrag = null;
    nameDragPending = null;
    controls.enabled = opts.interactive;
    if (finalState && pendingName) {
      applyNameDecal({ ...pendingName, ...finalState, projected: true });
      notifyNameTransform();
    } else if (pendingName) {
      // Ensure final state is projected/stuck to 3D.
      applyNameDecal({ ...pendingName, projected: true });
    }
  }

  renderer.domElement.addEventListener('pointerdown', onNamePointerDown);
  window.addEventListener('pointermove', onNamePointerMove);
  window.addEventListener('pointerup', onNamePointerUp);
  nameBox.addEventListener('pointerdown', onNamePointerDown);

  function applyFlagDecal({ type, imageDataUrl, placements = [] } = {}) {
    pendingFlag = { type, imageDataUrl, placements };
    if (!model || !localBox) return;
    const stale = flagGroup;
    flagGroup = null;
    disposeGroup(stale);
    buildFlagGroup(pendingFlag).then((group) => {
      if (!model || !localBox) return;
      // Newest call wins — drop anything replaced while loading.
      disposeGroup(flagGroup);
      flagGroup = group;
      scene.add(flagGroup);
    });
  }

  const COLOR_ORDER = ['hull', 'body', 'door', 'roof', 'deck', 'floor', 'lowerHull', 'rail'];

  function applyPendingColors() {
    if (!model) return;
    COLOR_ORDER.forEach((slot) => {
      if (pendingColors[slot]) applyColorSlot(model, slot, pendingColors[slot]);
    });
  }

  function resize() {
    if (destroyed) return;
    const w = el.clientWidth || width;
    const h = el.clientHeight || height;
    if (!w || !h) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function animate() {
    if (destroyed) return;
    frameId = requestAnimationFrame(animate);
    if (model) {
      // Ease the model toward the configured dimensions.
      model.scale.lerp(targetScale, 0.18);
      if (model.scale.distanceToSquared(targetScale) < 1e-8) model.scale.copy(targetScale);
      // Re-snap decals to the hull once the stretch settles.
      if (decalRebuildPending && model.scale.distanceToSquared(targetScale) < 1e-8) {
        decalRebuildPending = false;
        if (pendingName) applyNameDecal(pendingName);
        if (pendingFlag) applyFlagDecal(pendingFlag);
      }
    }
    controls.update();
    renderer.render(scene, camera);
    updateNameOverlay();
  }

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(el);
  }

  const readyPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      opts.modelUrl,
      (gltf) => {
        if (destroyed) {
          resolve();
          return;
        }
        model = gltf.scene;
        localBox = new THREE.Box3().setFromObject(model);
        // Where name lettering starts: the top of the lower hull stripe.
        // Fallback matches this model's stripe ratio if the material is absent.
        lowerHullTopY = captureLowerHullTopY();
        if (!Number.isFinite(lowerHullTopY)) {
          lowerHullTopY = localBox.min.y + localBox.getSize(new THREE.Vector3()).y * 0.14;
        }
        hullSideTopY = captureHullSideTopY();

        // Capture Blender-exported anchor empties (Anchor_Name_* /
        // Anchor_Flag_*). Anchors are recorded in SCENE-LOCAL space so decal
        // planes can be placed exactly where the model author put them,
        // independent of any centering/scaling we apply afterwards.
        model.updateMatrixWorld(true);
        const sceneInv = model.matrixWorld.clone().invert();
        model.traverse((obj) => {
          const m = /^anchor_(name|flag)_(sidel|sider|stern|bowl|bowr)$/i.exec(obj.name || '');
          if (!m) return;
          const rel = obj.matrixWorld.clone().premultiply(sceneInv);
          const pos = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl = new THREE.Vector3();
          rel.decompose(pos, quat, scl);
          anchors[(m[1] + '_' + m[2]).toLowerCase()] = {
            position: pos,
            quaternion: quat,
            scale: Math.max(scl.x, scl.y, scl.z) || 1,
          };
        });

        model.traverse((child) => {
          if (child.isMesh && child.material) {
            materialsOf(child).forEach((mat) => {
              // Render both sides so the hull is visible when orbiting below it.
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            });
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 12 / maxDim;
        model.scale.set(scale, scale, scale);
        scene.add(model);

        const box2 = new THREE.Box3().setFromObject(model);
        const size2 = box2.getSize(new THREE.Vector3());
        const center2 = box2.getCenter(new THREE.Vector3());
        const modelSize = Math.max(size2.x, size2.y, size2.z) || 12;

        // Record the base scale and which world axis is the boat's length
        // (the longer horizontal axis). The other horizontal axis is beam.
        baseScale = scale;
        lengthAxis = size2.x >= size2.z ? 'x' : 'z';
        beamAxis = lengthAxis === 'x' ? 'z' : 'x';
        applyDimensionFactors(true);

        camera.position.set(modelSize * 1.45, modelSize * 0.65, modelSize * 1.45);
        camera.near = modelSize * 0.01;
        camera.far = modelSize * 100;
        camera.updateProjectionMatrix();

        controls.target.copy(center2);
        controls.minDistance = modelSize * 0.65;
        controls.maxDistance = modelSize * 4.0;
        controls.update();

        applyPendingColors();
        applyPendingDecals();

        overlay.remove();
        ready = true;
        try { opts.onReady?.(); } catch (e) { /* non-fatal */ }
        resolve();
      },
      undefined,
      (error) => {
        overlay.textContent = '3D model failed to load';
        overlay.style.background = 'rgba(254,226,226,.85)';
        overlay.style.color = '#991b1b';
        console.error('[boatViewer] Failed to load model:', opts.modelUrl, error);
        try { opts.onError?.(error); } catch (e) { /* non-fatal */ }
        reject(error);
      }
    );
  });

  // Keep the error handled so an un-awaited readyPromise never throws.
  readyPromise.catch(() => {});

  animate();

  const api = {
    setColors(colors = {}) {
      Object.keys(colors).forEach((key) => {
        if (colors[key]) pendingColors[key] = colors[key];
      });
      applyPendingColors();
    },
    // Repaint the 3D stage in place. Safe to call at any time; the canvas,
    // camera, and the boat model are left untouched.
    setBackground(value) {
      const hex = toBackgroundHex(value);
      if (!hex) return;
      scene.background = new THREE.Color(hex);
      el.dataset.viewerBackground = hex;
    },
    // Boat name decal: one text decal pinned above the lower hull stripe.
    // Safe to call before load.
    // options: { sizeScale: 0.6..1.6, position: 0..1 around the hull }
    setName(text, font, color, placements = ['sides'], options = {}) {
      applyNameDecal({ text, font, color, placements, ...options });
    },
    clearName() {
      applyNameDecal({ text: '', font: 'Impact', color: '#ffffff', placements: [], sizeScale: 1, position: 0, y: null });
    },
    // Flag decal: type 'ph' (procedurally-drawn Philippine flag) or 'custom'
    // (customer-uploaded image data URL). Safe to call before the model loads.
    setFlag(type, imageDataUrl, placements = ['stern']) {
      applyFlagDecal({ type, imageDataUrl, placements });
    },
    clearFlag() {
      applyFlagDecal({ type: 'none', imageDataUrl: null, placements: [] });
    },
    // Stretch the boat horizontally: length along the length axis and beam
    // along the beam axis, both smoothly eased in the render loop.
    setDimensions(lengthFactor = 1, beamFactor = 1) {
      const lf = Number(lengthFactor);
      const bf = Number(beamFactor);
      pendingDimensions.lengthFactor = Number.isFinite(lf) ? Math.min(1.5, Math.max(0.5, lf)) : 1;
      pendingDimensions.beamFactor = Number.isFinite(bf) ? Math.min(1.5, Math.max(0.5, bf)) : 1;
      applyDimensionFactors(false);
      decalRebuildPending = true;
    },
    setAutoRotate,
    toggleAutoRotate() {
      setAutoRotate(!autoRotating);
      return autoRotating;
    },
    isAutoRotating() {
      return autoRotating;
    },
    zoom(dir) {
      dollyCamera(dir);
    },
    reset() {
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const modelSize = Math.max(size.x, size.y, size.z) || 12;
      camera.position.set(modelSize * 1.45, modelSize * 0.65, modelSize * 1.45);
      controls.target.copy(center);
      controls.minDistance = modelSize * 0.65;
      controls.maxDistance = modelSize * 4.0;
      controls.update();
      camera.updateProjectionMatrix();
      model.rotation.set(0, 0, 0);
    },
    resize,
    isReady() {
      return ready;
    },
    whenReady(timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('3D model load timed out'));
        }, timeoutMs);
        readyPromise.then(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        }, (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      });
    },
    getSnapshot(maxWidth = 1000, quality = 0.85) {
      if (!renderer || destroyed) return '';
      try {
        renderer.render(scene, camera);
        const source = renderer.domElement;
        const scale = Math.min(1, maxWidth / source.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#eef3f8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
      } catch (e) {
        console.warn('[boatViewer] Snapshot failed:', e);
        return '';
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frameId);
      if (nameDragRaf) { cancelAnimationFrame(nameDragRaf); nameDragRaf = 0; }
      nameDrag = null;
      nameDragPending = null;
      try { renderer.domElement.removeEventListener('pointerdown', onNamePointerDown); } catch (e) { /* non-fatal */ }
      try { window.removeEventListener('pointermove', onNamePointerMove); } catch (e) { /* non-fatal */ }
      try { window.removeEventListener('pointerup', onNamePointerUp); } catch (e) { /* non-fatal */ }
      try { nameBox.removeEventListener('pointerdown', onNamePointerDown); } catch (e) { /* non-fatal */ }
      try { resizeObserver?.disconnect(); } catch (e) { /* non-fatal */ }
      try { controls.dispose(); } catch (e) { /* non-fatal */ }
      try {
        scene.traverse((obj) => {
          if (!obj.isMesh) return;
          if (obj.geometry) obj.geometry.dispose();
          materialsOf(obj).forEach((mat) => {
            if (!mat) return;
            if (mat.map) mat.map.dispose?.();
            mat.dispose?.();
          });
        });
      } catch (e) { /* non-fatal */ }
      try { renderer.dispose(); } catch (e) { /* non-fatal */ }
      try {
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      } catch (e) { /* non-fatal */ }
      try { overlay.remove(); } catch (e) { /* non-fatal */ }
      try { nameOverlay.remove(); } catch (e) { /* non-fatal */ }
    },
  };

  return api;
}

/**
 * Render the boat off-screen and return a JPEG data URL. Used when the
 * customizer is submitted so the admin dashboard shows the 3D boat instead
 * of the old 2D drawing.
 */
export async function captureBoatSnapshot({
  colors = {},
  dimensions = null,
  background = 0xeef3f8,
  width = 900,
  height = 560,
  timeout = 8000,
} = {}) {
  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed', 'left:-10000px', 'top:0',
    `width:${width}px`, `height:${height}px`, 'pointer-events:none',
  ].join(';');
  document.body.appendChild(host);

  let viewer = null;
  try {
    viewer = createBoatViewer(host, {
      colors,
      dimensions,
      autoRotate: false,
      interactive: false,
      background,
      fallbackWidth: width,
      fallbackHeight: height,
    });
    await viewer.whenReady(timeout);
    // Let the animation loop render at least one full frame before capture.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return viewer.getSnapshot(width, 0.85) || '';
  } catch (e) {
    console.warn('[boatViewer] Off-screen snapshot failed:', e);
    return '';
  } finally {
    try { viewer?.destroy(); } catch (e) { /* non-fatal */ }
    try { host.remove(); } catch (e) { /* non-fatal */ }
  }
}
