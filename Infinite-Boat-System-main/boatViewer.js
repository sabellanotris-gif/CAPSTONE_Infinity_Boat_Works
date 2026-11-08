import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Single shared model file so both the customizer and the dashboards
// always show the same boat preview.
const MODEL_URL = new URL('models/final-boat.glb', import.meta.url).href + '?v=1';

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
      return matName.includes('hull') || matName.includes('lower') || matName.includes('stripe');
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
      return matName.includes('lower');
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
    ...options,
  };

  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  let width = el.clientWidth || opts.fallbackWidth;
  let height = el.clientHeight || opts.fallbackHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background);

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

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = opts.interactive;
  controls.zoomSpeed = 0.6;
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

  const pendingColors = {};
  Object.keys(opts.colors || {}).forEach((key) => {
    if (opts.colors[key]) pendingColors[key] = opts.colors[key];
  });

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
    controls.update();
    renderer.render(scene, camera);
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

        camera.position.set(modelSize * 1.45, modelSize * 0.65, modelSize * 1.45);
        camera.near = modelSize * 0.01;
        camera.far = modelSize * 100;
        camera.updateProjectionMatrix();

        controls.target.copy(center2);
        controls.minDistance = modelSize * 1.05;
        controls.maxDistance = modelSize * 2.6;
        controls.update();

        applyPendingColors();

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
    setAutoRotate,
    toggleAutoRotate() {
      setAutoRotate(!autoRotating);
      return autoRotating;
    },
    isAutoRotating() {
      return autoRotating;
    },
    zoom(dir) {
      const scale = dir > 0 ? 0.94 : 1.06;
      camera.position.sub(controls.target);
      camera.position.multiplyScalar(scale);
      camera.position.add(controls.target);
      controls.update();
    },
    reset() {
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const modelSize = Math.max(size.x, size.y, size.z) || 12;
      camera.position.set(modelSize * 1.45, modelSize * 0.6, modelSize * 1.45);
      controls.target.copy(center);
      controls.minDistance = modelSize * 1.05;
      controls.maxDistance = modelSize * 2.6;
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
      autoRotate: false,
      interactive: false,
      background: 0xeef3f8,
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
