// Custom HSV color wheel used by the boat customizer's color sections.
// A hue ring surrounds a saturation/brightness square. Dragging paints
// either the ring (hue) or the square (saturation + brightness); every
// change is reported as a hex string via onChange.

export function hsvToHex(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s)) / 100;
  v = Math.min(100, Math.max(0, v)) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to2 = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b);
}

export function hexToHsv(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { h: 220, s: 80, v: 90 };
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  hue = ((hue % 360) + 360) % 360;
  const sat = max === 0 ? 0 : (d / max) * 100;
  return { h: hue, s: sat, v: max * 100 };
}
export function isValidHex(hex) {
  const h = String(hex || '').trim().replace(/^#/, '');
  return /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h);
}

/**
 * Mount a wheel inside `container`.
 * options: { onChange(hex), initialHex, size }
 * Returns { setHex(hex), getHex(), destroy() }.
 */
export function createColorWheel(container, options = {}) {
  const { onChange = () => {}, initialHex = '#ffffff', size = 170 } = options;

  const state = hexToHsv(isValidHex(initialHex) ? initialHex : '#ffffff');

  const wrap = document.createElement('div');
  wrap.className = 'wheel-wrap';

  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.style.touchAction = 'none';
  canvas.style.display = 'block';
  canvas.style.cursor = 'crosshair';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const footer = document.createElement('div');
  footer.className = 'wheel-footer';

  const chip = document.createElement('span');
  chip.className = 'wheel-chip';

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'wheel-hex';
  hexInput.spellcheck = false;
  hexInput.autocomplete = 'off';
  hexInput.setAttribute('aria-label', 'Hex color value');

  footer.appendChild(chip);
  footer.appendChild(hexInput);
  wrap.appendChild(canvas);
  wrap.appendChild(footer);
  container.appendChild(wrap);

  const cx = size / 2;
  const cy = size / 2;
  const ringOuter = size / 2 - 2;
  const ringWidth = size * 0.15;
  const ringRadius = ringOuter - ringWidth / 2;
  const innerRadius = ringOuter - ringWidth - 3;
  const squareHalf = (innerRadius / Math.SQRT2) * 0.94;

  function pointInSquare(x, y) {
    return Math.abs(x - cx) <= squareHalf && Math.abs(y - cy) <= squareHalf;
  }
  function radiusOf(x, y) {
    return Math.hypot(x - cx, y - cy);
  }

  function draw() {
    ctx.clearRect(0, 0, size, size);

    // Hue ring, drawn as stroked arc segments.
    const segments = 120;
    ctx.lineWidth = ringWidth;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1.5) / segments) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = `hsl(${(i / segments) * 360}, 100%, 50%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, a0, a1);
      ctx.stroke();
    }

    // Saturation/brightness square: white → hue horizontally, transparent → black vertically.
    const x0 = cx - squareHalf, y0 = cy - squareHalf, side = squareHalf * 2;
    const hueHex = hsvToHex(state.h, 100, 100);
    const gradH = ctx.createLinearGradient(x0, 0, x0 + side, 0);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, hueHex);
    ctx.fillStyle = gradH;
    ctx.fillRect(x0, y0, side, side);
    const gradV = ctx.createLinearGradient(0, y0, 0, y0 + side);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, '#000000');
    ctx.fillStyle = gradV;
    ctx.fillRect(x0, y0, side, side);
    ctx.strokeStyle = 'rgba(15,23,42,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);

    // Hue marker on the ring.
    const hueAngle = (state.h * Math.PI) / 180 - Math.PI / 2;
    const mx = cx + Math.cos(hueAngle) * ringRadius;
    const my = cy + Math.sin(hueAngle) * ringRadius;
    ctx.beginPath();
    ctx.arc(mx, my, ringWidth / 2 - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = hsvToHex(state.h, 100, 100);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // SV marker in the square.
    const svx = x0 + (state.s / 100) * side;
    const svy = y0 + (1 - state.v / 100) * side;
    ctx.beginPath();
    ctx.arc(svx, svy, 6, 0, Math.PI * 2);
    ctx.fillStyle = hsvToHex(state.h, state.s, state.v);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(svx, svy, 6, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15,23,42,0.45)';
    ctx.stroke();
  }

  function syncFooter() {
    const hex = hsvToHex(state.h, state.s, state.v);
    chip.style.background = hex;
    if (document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
    return hex;
  }

  function emit() {
    draw();
    const hex = syncFooter();
    onChange(hex);
  }

  function pickFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const y = ((e.clientY - rect.top) / rect.height) * size;
    return { x, y };
  }

  let dragMode = null; // 'hue' | 'sv' | null

  function applyPointer(e) {
    const { x, y } = pickFromEvent(e);
    if (dragMode === 'hue') {
      let deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      state.h = deg;
      emit();
    } else if (dragMode === 'sv') {
      const rel = (v, min, max) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
      state.s = rel(x, cx - squareHalf, cx + squareHalf);
      state.v = 100 - rel(y, cy - squareHalf, cy + squareHalf);
      emit();
    }
  }

  function onPointerDown(e) {
    const { x, y } = pickFromEvent(e);
    const r = radiusOf(x, y);
    if (r >= innerRadius && r <= ringOuter) {
      dragMode = 'hue';
    } else if (pointInSquare(x, y)) {
      dragMode = 'sv';
    } else {
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    applyPointer(e);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragMode) return;
    applyPointer(e);
    e.preventDefault();
  }

  function onPointerUp(e) {
    dragMode = null;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch (_) { /* non-fatal */ }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  hexInput.addEventListener('change', () => {
    const raw = hexInput.value.trim();
    if (!isValidHex(raw)) {
      hexInput.value = hsvToHex(state.h, state.s, state.v).toUpperCase();
      return;
    }
    const parsed = hexToHsv(raw);
    state.h = parsed.h;
    state.s = parsed.s;
    state.v = parsed.v;
    emit();
  });

  draw();
  syncFooter();

  return {
    setHex(hex) {
      if (!isValidHex(hex)) return;
      const parsed = hexToHsv(hex);
      state.h = parsed.h;
      state.s = parsed.s;
      state.v = parsed.v;
      draw();
      syncFooter();
    },
    getHex() {
      return hsvToHex(state.h, state.s, state.v);
    },
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      wrap.remove();
    },
  };
}
