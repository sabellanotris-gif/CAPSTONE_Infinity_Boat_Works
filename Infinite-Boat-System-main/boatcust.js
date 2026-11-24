import { supabase, handleDbError, sendEmailNotification, getCustomerIdentity, landingForRole, ADMIN_EMAIL } from "./supabase.js";
import { getBoatSpecs } from "./boatData.js";
import { showThreeView, setDeckColor, setFloorColor, setLowerHullColor, setRailColor, setBodyColor, setRoofColor, setThreeBackground, rotateThree, zoomThree, resetThree, setAutoRotateListener, captureThreePreview, setDimensions, setBoatName, setBoatFlag } from "./boat3d.js";
import { createColorWheel } from "./colorWheel.js";

// Staff must not browse the customer boat composer. Customers and unauthenticated
// previews are allowed (preview mode is intentional for unplaced boats).
(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
    if (profile && ["admin", "manager", "worker"].includes(profile.role)) {
      window.location.href = landingForRole(profile.role);
    }
  } catch (e) { /* non-fatal */ }
})();

  // Ensure the logged-in customer's identity (never a stale admin/worker name)
  (async () => {
    try {
      const identity = await getCustomerIdentity();
      if (identity.name) sessionStorage.setItem("customerName", identity.name);
      if (identity.email) sessionStorage.setItem("customerEmail", identity.email);
      if (identity.phone) sessionStorage.setItem("customerPhone", identity.phone);
      if (identity.photo) sessionStorage.setItem("customerImage", identity.photo);
    } catch (e) { /* non-fatal */ }
  })();

// Default boat colors shown before the customer picks anything.
const DEFAULT_BODY_HEX = '#ffffff';
const DEFAULT_LOWER_HULL_HEX = '#2563eb';
const DEFAULT_RAIL_HEX = '#F0F0F0';
const DEFAULT_ROOF_HEX = '#D9DDE0';
const DEFAULT_FLOOR_HEX = '#8B7355';
const DEFAULT_BACKGROUND_HEX = '#87ceeb';

// Free, visual-only presets for the 3D stage. They are never priced and are
// not part of the saved boat configuration.
const BACKGROUND_PRESETS = [
  { name: 'Sky Blue', hex: '#87ceeb' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Light Gray', hex: '#eef3f8' },
  { name: 'Dark Navy', hex: '#0f172a' },
  { name: 'Ocean', hex: '#0ea5e9' },
];

// The 7 shared primary presets rendered in every color section. Anything
// picked from the custom wheel (or any non-preset hex) is charged like a
// non-default preset.
const PRESET_COLORS = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#111827' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#166534' },
  { name: 'Gray', hex: '#9ca3af' },
];

// Flat fee for a custom wheel color in sections that are not covered by
// boat-type paint pricing (Roof / Floor / Rail).
const CUSTOM_SECTION_PAINT_PRICE = 8000;

let hullColor = DEFAULT_BODY_HEX;
let deckColor = DEFAULT_FLOOR_HEX;
let roofColor = DEFAULT_ROOF_HEX;
let lowerHullColor = DEFAULT_LOWER_HULL_HEX;
let railColor = DEFAULT_RAIL_HEX;
let backgroundHex = DEFAULT_BACKGROUND_HEX;
let colorPrice = 0;
let deckColorPrice = 0;
let roofColorPrice = 0;
let lowerHullColorPrice = 0;
let railColorPrice = 0;
let inventoryItems = { engines: [], colors: [], deckColors: [], railColors: [] };

function sameColor(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function setBackgroundChoice(hex) {
  backgroundHex = hex;
  setThreeBackground(hex);
  document.querySelectorAll('.colors.background-colors .color').forEach(el => {
    el.classList.toggle('active', sameColor(el.dataset.background, hex));
  });
}

function buildBackgroundSwatches() {
  const container = document.querySelector('.colors.background-colors');
  if (!container) return;
  container.innerHTML = BACKGROUND_PRESETS.map(p => `
    <div class="color${sameColor(p.hex, backgroundHex) ? ' active' : ''}"
         data-background="${p.hex}" style="background:${p.hex}" title="${p.name}"></div>
  `).join('');
  container.querySelectorAll('.color').forEach(el => {
    el.addEventListener('click', () => setBackgroundChoice(el.dataset.background));
  });
}

function isDefaultBodyColor(hex) {
  return sameColor(hex, DEFAULT_BODY_HEX);
}

function isDefaultLowerHullColor(hex) {
  return sameColor(hex, DEFAULT_LOWER_HULL_HEX);
}

function isDefaultRailColor(hex) {
  return sameColor(hex, DEFAULT_RAIL_HEX);
}

function isRoofDefault(hex) {
  return sameColor(hex, DEFAULT_ROOF_HEX);
}

function isFloorDefault(hex) {
  return sameColor(hex, DEFAULT_FLOOR_HEX);
}

function presetNameFor(hex) {
  const match = PRESET_COLORS.find(p => sameColor(p.hex, hex));
  return match ? match.name : 'Custom Paint';
}

// Every section charges its non-default colors like a non-default preset;
// the section default is always free. Arbitrary wheel colors are priced the
// same way.
function getSectionColorPrice(section, hex) {
  switch (section) {
    case 'hull':
      return isDefaultBodyColor(hex) ? 0 : getHullColorPricing();
    case 'lower-hull':
      return isDefaultLowerHullColor(hex) ? 0 : getHullColorPricing();
    case 'roof':
      return isRoofDefault(hex) ? 0 : CUSTOM_SECTION_PAINT_PRICE;
    case 'floor':
      return isFloorDefault(hex) ? 0 : CUSTOM_SECTION_PAINT_PRICE;
    case 'rail':
      return isDefaultRailColor(hex) ? 0 : CUSTOM_SECTION_PAINT_PRICE;
    default:
      return 0;
  }
}

// Registry describing the five color sections; shared by the preset swatch
// builder, the custom wheels and the revision-mode restore path.
const COLOR_SECTIONS = [
  { key: 'hull', containerSelector: '.colors.hull-colors', getHex: () => hullColor, setHex: (v) => { hullColor = v; }, defaultHex: DEFAULT_BODY_HEX, apply3D: (v) => { if (typeof setBodyColor === 'function') setBodyColor(v); } },
  { key: 'roof', containerSelector: '.colors.roof-colors', getHex: () => roofColor, setHex: (v) => { roofColor = v; }, defaultHex: DEFAULT_ROOF_HEX, apply3D: (v) => { if (typeof setRoofColor === 'function') setRoofColor(v); } },
  { key: 'floor', containerSelector: '.colors.floor-colors', getHex: () => deckColor, setHex: (v) => { deckColor = v; }, defaultHex: DEFAULT_FLOOR_HEX, apply3D: (v) => { if (typeof setFloorColor === 'function') setFloorColor(v); else setDeckColor(v); } },
  { key: 'lower-hull', containerSelector: '.colors.lower-hull-colors', getHex: () => lowerHullColor, setHex: (v) => { lowerHullColor = v; }, defaultHex: DEFAULT_LOWER_HULL_HEX, apply3D: (v) => { if (typeof setLowerHullColor === 'function') setLowerHullColor(v); } },
  { key: 'rail', containerSelector: '.colors.rail-colors', getHex: () => railColor, setHex: (v) => { railColor = v; }, defaultHex: DEFAULT_RAIL_HEX, apply3D: (v) => { if (typeof setRailColor === 'function') setRailColor(v); } },
];

function sectionByKey(key) {
  return COLOR_SECTIONS.find(s => s.key === key) || null;
}

const wheelControls = {};

function scheduleColorRefresh() {
  if (scheduleColorRefresh.queued) return;
  scheduleColorRefresh.queued = true;
  requestAnimationFrame(() => {
    scheduleColorRefresh.queued = false;
    refreshSummary(); // refreshSummary() also recomputes the summary prices
  });
}

// Single entry point for both preset swatches and wheel picks.
function applySectionColor(key, hex, { fromWheel = false } = {}) {
  const section = sectionByKey(key);
  if (!section) return;
  section.setHex(hex);
  section.apply3D(hex);
  const container = document.querySelector(section.containerSelector);
  let matchedPreset = false;
  if (container) {
    container.querySelectorAll('.color').forEach(el => {
      const on = sameColor(el.dataset.color, hex);
      el.classList.toggle('active', on);
      if (on) matchedPreset = true;
    });
  }
  const toggle = document.querySelector(`.wheel-toggle[data-wheel="${key}"]`);
  if (toggle) toggle.classList.toggle('active', !matchedPreset);
  const wheel = wheelControls[key];
  if (wheel && !fromWheel) wheel.setHex(hex);
  scheduleColorRefresh();
}

function buildPresetSwatches(section, activeHex) {
  const container = document.querySelector(section.containerSelector);
  if (!container) return;
  const active = (hex) => sameColor(hex, activeHex);
  const defaultIsPreset = PRESET_COLORS.some(p => sameColor(p.hex, section.defaultHex));
  let html = '';
  if (!defaultIsPreset) {
    html += `<div class="color default${active(section.defaultHex) ? ' active' : ''}" data-color="${section.defaultHex}" data-default="true" style="background:${section.defaultHex}" title="Default"></div>`;
  }
  html += PRESET_COLORS.map(p => {
    const isDef = sameColor(p.hex, section.defaultHex);
    return `<div class="color${isDef ? ' default' : ''}${active(p.hex) ? ' active' : ''}" data-color="${p.hex}" data-name="${p.name}" data-default="${isDef ? 'true' : 'false'}" style="background:${p.hex}" title="${p.name}"></div>`;
  }).join('');
  container.innerHTML = html;
  container.querySelectorAll('.color').forEach(el => {
    el.addEventListener('click', () => applySectionColor(section.key, el.dataset.color));
  });
}

function toggleWheelPanel(key) {
  const panel = document.getElementById('wheelPanel-' + key);
  const toggle = document.querySelector(`.wheel-toggle[data-wheel="${key}"]`);
  const section = sectionByKey(key);
  if (!panel || !toggle || !section) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  toggle.classList.toggle('open', willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
  if (willOpen && !wheelControls[key]) {
    wheelControls[key] = createColorWheel(panel, {
      initialHex: section.getHex(),
      size: 170,
      onChange: (hex) => applySectionColor(key, hex, { fromWheel: true }),
    });
  }
}

function setupWheelToggles() {
  document.querySelectorAll('.wheel-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleWheelPanel(btn.dataset.wheel));
  });
}

const HULL_COLOR_PRICING = {
  'Speed Boat': 50000,
  'Passenger Boat': 100000,
  'Parasail Boat': 100000,
  'Patrol Boat': 150000
};

function getHullColorPricing() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem('customBuildDraft')); } catch (e) { return 0; }
  const name = draft?.boatData?.name || '';
  const match = Object.keys(HULL_COLOR_PRICING).find(k => name.toLowerCase().includes(k.toLowerCase().split(' ')[0]));
  return match ? HULL_COLOR_PRICING[match] : 0;
}

function getDraftBoatName() {
  try { return JSON.parse(localStorage.getItem('customBuildDraft'))?.boatData?.name || ''; } catch (e) { return ''; }
}

function parseSpecMeters(str) {
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function getOriginalPrice() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem('customBuildDraft')); } catch (e) { draft = null; }
  const fromDraft = draft?.boatData?.price
    ? parseFloat(String(draft.boatData.price).replace(/[^0-9.]/g, ''))
    : 0;
  if (fromDraft > 0) return fromDraft;
  const specs = getBoatSpecs(getDraftBoatName());
  const fromSpecs = specs?.basePrice ? parseFloat(String(specs.basePrice).replace(/[^0-9.]/g, '')) : 0;
  return fromSpecs > 0 ? fromSpecs : 1400000;
}

function isPassengerBoatName(name) {
  return /passenger/i.test(name || '');
}

function applyBoatSpecDefaults() {
  if (revisionOrderId) return;
  const name = getDraftBoatName();
  const specs = getBoatSpecs(name);
  if (!specs) return;
  const stdLength = parseSpecMeters(specs.length);
  const stdWidth = parseSpecMeters(specs.breadth);
  if (stdLength) {
    lengthRange.min = Math.round(stdLength * 0.8 * 10) / 10;
    lengthRange.max = Math.round(stdLength * 1.2 * 10) / 10;
    lengthRange.step = 0.1;
    lengthRange.value = stdLength;
    lengthValue.textContent = stdLength + 'm';
  }
  if (stdWidth) {
    widthRange.min = Math.round(stdWidth * 0.8 * 10) / 10;
    widthRange.max = Math.round(stdWidth * 1.2 * 10) / 10;
    widthRange.step = 0.05;
    widthRange.value = stdWidth;
    widthValue.textContent = stdWidth + 'm';
  }
}

const lengthRange = document.getElementById('lengthRange');
const widthRange = document.getElementById('widthRange');
const lengthValue = document.getElementById('lengthValue');
const widthValue = document.getElementById('widthValue');
const engineBrand = document.getElementById('engineBrand');
const engineHP = document.getElementById('engineHP');

function parseSpecTotalHp(specs) {
  const str = String(specs?.enginePower || '');
  const match = str.match(/([\d,]+)\s*HP/i);
  if (!match) return null;
  const hp = parseInt(match[1].replace(/,/g, ''), 10);
  if (!hp) return null;
  return /x\s*2|×\s*2/i.test(str) ? hp * 2 : hp;
}

function getVisibleEngines() {
  const name = getDraftBoatName();
  if (!isPassengerBoatName(name)) {
    return inventoryItems.engines.filter(e => !e.metadata?.forPassenger);
  }
  const packages = inventoryItems.engines.filter(e => e.metadata?.forPassenger === true);
  const totalHp = parseSpecTotalHp(getBoatSpecs(name));
  if (!totalHp) return packages;
  const exact = packages.filter(e => e.metadata?.hp === totalHp);
  return exact.length > 0 ? exact : packages;
}

function populateEngineHP(brand) {
  const visible = getVisibleEngines();
  const filtered = brand ? visible.filter(e => e.metadata?.brand === brand) : [];
  engineHP.innerHTML = '<option value="0" data-id="" data-name="None">None</option>' +
    filtered.map(e => {
      const hp = e.metadata?.hp || '';
      const count = e.metadata?.count || 1;
      const unitHp = e.metadata?.unitHp || hp;
      const label = e.metadata?.label || (count > 1 ? `${hp} HP (${count}× ${unitHp})` : `${hp} HP`);
      return `<option value="${e.price}" data-id="${e.id}" data-name="${e.name}" data-hp="${hp}" title="${e.name}">${label}</option>`;
    }).join('');
  const first = filtered.length > 0 ? engineHP.querySelector(`option[data-id="${filtered[0].id}"]`) : null;
  if (first) first.selected = true;
}

function applyDefaultEngineSelection() {
  if (revisionOrderId) return;
  const visible = getVisibleEngines();
  if (visible.length === 0) return;
  const name = getDraftBoatName();
  let target = null;
  if (isPassengerBoatName(name)) {
    const totalHp = parseSpecTotalHp(getBoatSpecs(name));
    target = visible.find(e => e.metadata?.default === true);
    if (!target && totalHp) {
      target = visible.find(e => e.metadata?.hp === totalHp)
        || visible.reduce((best, e) => {
          if (!best) return e;
          const diff = Math.abs((e.metadata?.hp || 0) - totalHp);
          const bestDiff = Math.abs((best.metadata?.hp || 0) - totalHp);
          return diff < bestDiff ? e : best;
        }, null);
    }
  }
  if (!target) target = visible[0];
  if (!target) return;
  engineBrand.value = target.metadata?.brand || '';
  populateEngineHP(engineBrand.value);
  const opt = engineHP.querySelector(`option[data-id="${target.id}"]`);
  if (opt) opt.selected = true;
}

const BOAT_PRICING = {
  'Speed Boat': { rate: 107000, stdLength: 5.8, stdWidth: 2.25 },
  '1950 Passenger Boat': { rate: 50000, stdLength: 19.5, stdWidth: 4.2 },
  '2680 Passenger Boat': { rate: 50000, stdLength: 26.8, stdWidth: 6.0 },
  'Passenger Boat': { rate: 50000, stdLength: 19.5, stdWidth: 4.2 },
  'Parasail Boat': { rate: 80000, stdLength: 11, stdWidth: 3.0 },
  'Patrol Boat': { rate: 90000, stdLength: 12, stdWidth: 3.3 }
};

function getBoatPricing() {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const name = draft?.boatData?.name || '';
  const match = Object.keys(BOAT_PRICING).find(k => name.toLowerCase().includes(k.toLowerCase().split(' ')[0]));
  return match ? BOAT_PRICING[match] : { rate: 50000, stdLength: 10, stdWidth: 2.8 };
}
const NAME_LETTERING_PRICE = 15000;
const FLAG_PRICE = 3500;
const NAME_COLOR_SWATCHES = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#111827' },
  { name: 'Gold', hex: '#D4AF37' },
  { name: 'Silver', hex: '#C0C0C0' },
  { name: 'Navy', hex: '#1e3a5f' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Cream', hex: '#F5F5DC' },
  { name: 'Charcoal', hex: '#374151' },
];
let selectedNameColor = '#ffffff';
let uploadedFlagImage = ''; // data URL of the custom-uploaded flag (empty = none)

const totalPrice = document.getElementById('totalPrice');
const safetyBox = document.getElementById('safetyBox');
const boatNameText = document.getElementById('boatNameText');
const boatNameFont = document.getElementById('boatNameFont');
const boatNameColorsBox = document.getElementById('boatNameColors');
const flagPhPreview = document.getElementById('flagPhPreview');
const flagUploadBox = document.getElementById('flagUploadBox');
const flagFile = document.getElementById('flagFile');
const flagPreview = document.getElementById('flagPreview');
const boatNameRow = document.getElementById('boatNameRow');
const boatNameDisplay = document.getElementById('boatNameDisplay');
const flagRow = document.getElementById('flagRow');
const flagDisplay = document.getElementById('flagDisplay');

const getCheckedValues = (name) =>
  Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);

function getBoatNameState() {
  return {
    text: (boatNameText?.value || '').trim().toUpperCase(),
    font: boatNameFont?.value || 'Impact',
    color: selectedNameColor,
    placements: getCheckedValues('namePlacement'),
  };
}

function getFlagState() {
  const type = document.querySelector('input[name="flagType"]:checked')?.value || 'none';
  return {
    type,
    imageDataUrl: type === 'custom' ? uploadedFlagImage : '',
    placements: getCheckedValues('flagPlacement'),
  };
}

const isBoatNameActive = () => getBoatNameState().text.length > 0;
const isFlagActive = () => getFlagState().type !== 'none';
const computeNameFlagFees = () => ({
  nameFee: isBoatNameActive() ? NAME_LETTERING_PRICE : 0,
  flagFee: isFlagActive() ? FLAG_PRICE : 0,
});

function applyNameFlagTo3D() {
  const name = getBoatNameState();
  if (typeof setBoatName === 'function') setBoatName(name.text, name.font, name.color, name.placements);
  const flag = getFlagState();
  if (typeof setBoatFlag === 'function') setBoatFlag(flag.type, flag.imageDataUrl, flag.placements);
}

NAME_COLOR_SWATCHES.forEach(({ hex, name }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'name-swatch' + (hex === selectedNameColor ? ' active' : '');
  btn.style.background = hex;
  btn.dataset.hex = hex;
  btn.title = name;
  btn.setAttribute('aria-label', 'Boat name color ' + name);
  btn.addEventListener('click', () => {
    selectedNameColor = hex;
    boatNameColorsBox?.querySelectorAll('.name-swatch').forEach(el => el.classList.toggle('active', el === btn));
    applyNameFlagTo3D();
    refreshSummary();
  });
  boatNameColorsBox?.appendChild(btn);
});

let nameDebounce = null;
boatNameText?.addEventListener('input', () => {
  const pos = boatNameText.selectionStart;
  boatNameText.value = boatNameText.value.toUpperCase();
  try { boatNameText.setSelectionRange(pos, pos); } catch (e) { /* selection restore best-effort */ }
  clearTimeout(nameDebounce);
  nameDebounce = setTimeout(() => {
    applyNameFlagTo3D();
    refreshSummary();
  }, 220);
});
boatNameFont?.addEventListener('change', () => { applyNameFlagTo3D(); refreshSummary(); });
document.querySelectorAll('input[name="namePlacement"]').forEach(el =>
  el.addEventListener('change', () => { applyNameFlagTo3D(); refreshSummary(); }));
document.querySelectorAll('input[name="flagType"]').forEach(el =>
  el.addEventListener('change', () => {
    const type = document.querySelector('input[name="flagType"]:checked')?.value || 'none';
    if (flagPhPreview) flagPhPreview.style.display = type === 'ph' ? 'flex' : 'none';
    if (flagUploadBox) flagUploadBox.style.display = type === 'custom' ? 'block' : 'none';
    applyNameFlagTo3D();
    refreshSummary();
  }));
document.querySelectorAll('input[name="flagPlacement"]').forEach(el =>
  el.addEventListener('change', () => { applyNameFlagTo3D(); refreshSummary(); }));
flagFile?.addEventListener('change', () => {
  const file = flagFile.files && flagFile.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert('Please choose an image under 2 MB.');
    flagFile.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 256;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      uploadedFlagImage = canvas.toDataURL('image/png');
      if (flagPreview) { flagPreview.src = uploadedFlagImage; flagPreview.style.display = 'block'; }
      applyNameFlagTo3D();
      refreshSummary();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

const CUSTOMIZATION_SEED = [
  { name: 'Suzuki 150 HP', category: 'Engine', stock: 5, price: 700000, metadata: { brand: 'Suzuki', hp: 150, optionType: 'engine' } },
  { name: 'Suzuki 250 HP', category: 'Engine', stock: 5, price: 1346000, metadata: { brand: 'Suzuki', hp: 250, optionType: 'engine' } },
  { name: 'Suzuki 300 HP', category: 'Engine', stock: 5, price: 1469000, metadata: { brand: 'Suzuki', hp: 300, optionType: 'engine' } },
  { name: 'Mercury 150 HP', category: 'Engine', stock: 5, price: 850000, metadata: { brand: 'Mercury', hp: 150, optionType: 'engine' } },
  { name: 'Mercury 250 HP', category: 'Engine', stock: 5, price: 1400000, metadata: { brand: 'Mercury', hp: 250, optionType: 'engine' } },
  { name: 'Mercury 300 HP', category: 'Engine', stock: 5, price: 1700000, metadata: { brand: 'Mercury', hp: 300, optionType: 'engine' } },
  { name: 'Twin Suzuki DF350A', category: 'Engine', stock: 5, price: 2516202, metadata: { brand: 'Suzuki', hp: 700, unitHp: 350, count: 2, label: '700 HP (2× 350)', optionType: 'engine', forPassenger: true, default: true } },
  { name: '6× Mercury Verado 600', category: 'Engine', stock: 5, price: 29676000, metadata: { brand: 'Mercury', hp: 3600, unitHp: 600, count: 6, label: '1800 HP x2 (6× 600)', optionType: 'engine', forPassenger: true, default: true } },
  { name: 'Twin Mercury Verado 350', category: 'Engine', stock: 5, price: 3568500, metadata: { brand: 'Mercury', hp: 700, unitHp: 350, count: 2, label: '700 HP (2× 350)', optionType: 'engine', forPassenger: true } },
  { name: '12× Suzuki DF300AP', category: 'Engine', stock: 5, price: 14040000, metadata: { brand: 'Suzuki', hp: 3600, unitHp: 300, count: 12, label: '1800 HP x2 (12× 300)', optionType: 'engine', forPassenger: true } },
  { name: 'Default', category: 'Color', stock: 99, price: 0, metadata: { hex: '#111827', colorType: 'hull', optionType: 'color', isDefault: true } },
  { name: 'Body', category: 'Color', stock: 99, price: 0, metadata: { hex: '#F2F1E9', colorType: 'hull', optionType: 'color' } },
  { name: 'White', category: 'Color', stock: 99, price: 0, metadata: { hex: '#ffffff', colorType: 'hull', optionType: 'color' } },
  { name: 'Pearl White', category: 'Color', stock: 99, price: 5000, metadata: { hex: '#F5F5F0', colorType: 'hull', optionType: 'color' } },
  { name: 'Navy Blue', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#1e3a5f', colorType: 'hull', optionType: 'color' } },
  { name: 'Royal Blue', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#2563eb', colorType: 'hull', optionType: 'color' } },
  { name: 'Sky Blue', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#38bdf8', colorType: 'hull', optionType: 'color' } },
  { name: 'Racing Red', category: 'Color', stock: 99, price: 10000, metadata: { hex: '#dc2626', colorType: 'hull', optionType: 'color' } },
  { name: 'Maroon', category: 'Color', stock: 99, price: 10000, metadata: { hex: '#7f1d1d', colorType: 'hull', optionType: 'color' } },
  { name: 'Forest Green', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#166534', colorType: 'hull', optionType: 'color' } },
  { name: 'Lime Green', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#65a30d', colorType: 'hull', optionType: 'color' } },
  { name: 'Sunset Orange', category: 'Color', stock: 99, price: 10000, metadata: { hex: '#ea580c', colorType: 'hull', optionType: 'color' } },
  { name: 'Bright Yellow', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#eab308', colorType: 'hull', optionType: 'color' } },
  { name: 'Black', category: 'Color', stock: 99, price: 12000, metadata: { hex: '#111827', colorType: 'hull', optionType: 'color' } },
  { name: 'Charcoal', category: 'Color', stock: 99, price: 12000, metadata: { hex: '#374151', colorType: 'hull', optionType: 'color' } },
  { name: 'Silver', category: 'Color', stock: 99, price: 10000, metadata: { hex: '#9ca3af', colorType: 'hull', optionType: 'color' } },
  { name: 'Gunmetal', category: 'Color', stock: 99, price: 12000, metadata: { hex: '#4a5568', colorType: 'hull', optionType: 'color' } },
  { name: 'Teal', category: 'Color', stock: 99, price: 8000, metadata: { hex: '#0d9488', colorType: 'hull', optionType: 'color' } },
  { name: 'Rose Gold', category: 'Color', stock: 99, price: 15000, metadata: { hex: '#b76e79', colorType: 'hull', optionType: 'color' } },
  { name: 'Burgundy', category: 'Color', stock: 99, price: 10000, metadata: { hex: '#800020', colorType: 'hull', optionType: 'color' } },
  { name: 'Bronze', category: 'Color', stock: 99, price: 12000, metadata: { hex: '#CD7F32', colorType: 'hull', optionType: 'color' } },
  { name: 'Midnight Blue', category: 'Color', stock: 99, price: 10000, metadata: { hex: '#191970', colorType: 'hull', optionType: 'color' } },
  { name: 'Purple', category: 'Color', stock: 99, price: 12000, metadata: { hex: '#6B21A8', colorType: 'hull', optionType: 'color' } },
  { name: 'Default Deck', category: 'DeckColor', stock: 99, price: 0, metadata: { hex: '#8B7355', colorType: 'deck', optionType: 'deckColor', isDefault: true } },
  { name: 'Roof', category: 'DeckColor', stock: 99, price: 0, metadata: { hex: '#D9DDE0', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Teak Wood', category: 'DeckColor', stock: 99, price: 0, metadata: { hex: '#8B7355', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Dark Teak', category: 'DeckColor', stock: 99, price: 5000, metadata: { hex: '#5C4033', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Light Oak', category: 'DeckColor', stock: 99, price: 5000, metadata: { hex: '#C4A35A', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'White Composite', category: 'DeckColor', stock: 99, price: 8000, metadata: { hex: '#E8E8E0', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Grey Composite', category: 'DeckColor', stock: 99, price: 8000, metadata: { hex: '#808080', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Black EVA', category: 'DeckColor', stock: 99, price: 10000, metadata: { hex: '#2D2D2D', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Honey Teak', category: 'DeckColor', stock: 99, price: 8000, metadata: { hex: '#D4A76A', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Blue Composite', category: 'DeckColor', stock: 99, price: 10000, metadata: { hex: '#4A6FA5', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Red EVA', category: 'DeckColor', stock: 99, price: 10000, metadata: { hex: '#8B2500', colorType: 'deck', optionType: 'deckColor' } },
  { name: 'Default Rail', category: 'RailColor', stock: 99, price: 0, metadata: { hex: '#C0C0C0', colorType: 'rail', optionType: 'railColor', isDefault: true } },
  { name: 'Door', category: 'Color', stock: 99, price: 0, metadata: { hex: '#4D4127', colorType: 'hull', optionType: 'color' } },
  { name: 'Chrome Rail', category: 'RailColor', stock: 99, price: 0, metadata: { hex: '#C0C0C0', colorType: 'rail', optionType: 'railColor' } },
  { name: 'Brushed Steel', category: 'RailColor', stock: 99, price: 5000, metadata: { hex: '#A8A8A8', colorType: 'rail', optionType: 'railColor' } },
  { name: 'Black Rail', category: 'RailColor', stock: 99, price: 8000, metadata: { hex: '#1a1a1a', colorType: 'rail', optionType: 'railColor' } },
  { name: 'Gold Rail', category: 'RailColor', stock: 99, price: 15000, metadata: { hex: '#D4AF37', colorType: 'rail', optionType: 'railColor' } },
  { name: 'White Rail', category: 'RailColor', stock: 99, price: 5000, metadata: { hex: '#F0F0F0', colorType: 'rail', optionType: 'railColor' } },
  { name: 'Bronze Rail', category: 'RailColor', stock: 99, price: 15000, metadata: { hex: '#CD7F32', colorType: 'rail', optionType: 'railColor' } },
  { name: 'Copper Rail', category: 'RailColor', stock: 99, price: 12000, metadata: { hex: '#B87333', colorType: 'rail', optionType: 'railColor' } },
  { name: 'Titanium Rail', category: 'RailColor', stock: 99, price: 18000, metadata: { hex: '#878681', colorType: 'rail', optionType: 'railColor' } }
];

async function loadOptions() {
  let { data } = await supabase.from("inventory").select("*");
  const cats = ['Engine', 'Color', 'DeckColor', 'RailColor'];
  let customizationItems = (data || []).filter(i => cats.includes(i.category));

  if (!data || customizationItems.length === 0) {
    for (const item of CUSTOMIZATION_SEED) {
      await supabase.from("inventory").insert(item);
    }
    const { data: seeded } = await supabase.from("inventory").select("*");
    data = seeded || [];
  } else {
    const seen = new Map();
    const toDelete = [];
    customizationItems.forEach(i => {
      const key = i.category + '|' + i.name;
      if (seen.has(key)) toDelete.push(i.id);
      else seen.set(key, true);
    });
    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await supabase.from("inventory").delete().eq("id", id);
      }
      const { data: cleaned } = await supabase.from("inventory").select("*");
      data = cleaned || [];
    }
  }

  const existingNames = new Set(customizationItems.map(i => i.category + '|' + i.name));
  const missing = CUSTOMIZATION_SEED.filter(s => !existingNames.has(s.category + '|' + s.name));
  if (missing.length > 0) {
    for (const item of missing) {
      await supabase.from("inventory").insert(item);
    }
    const { data: updated } = await supabase.from("inventory").select("*");
    data = updated || [];
  }

  const seedNames = new Set(CUSTOMIZATION_SEED.map(s => s.category + '|' + s.name));
  const staleItems = customizationItems.filter(i => !seedNames.has(i.category + '|' + i.name));
  if (staleItems.length > 0) {
    for (const item of staleItems) {
      await supabase.from("inventory").delete().eq("id", item.id);
    }
    const { data: cleaned2 } = await supabase.from("inventory").select("*");
    data = cleaned2 || [];
  }

  const engineItems = data.filter(i => i.category === 'Engine');
  const staleEngines = engineItems.filter(e => !e.metadata?.brand);
  if (staleEngines.length > 0) {
    for (const e of engineItems) {
      await supabase.from("inventory").delete().eq("id", e.id);
    }
    for (const item of CUSTOMIZATION_SEED.filter(i => i.category === 'Engine')) {
      await supabase.from("inventory").insert(item);
    }
    const { data: refreshed } = await supabase.from("inventory").select("*");
    data = refreshed || [];
  }

  inventoryItems.engines = data.filter(i => i.category === 'Engine').sort((a, b) => a.price - b.price);
  inventoryItems.colors = data.filter(i => i.category === 'Color');
  inventoryItems.deckColors = data.filter(i => i.category === 'DeckColor');
  inventoryItems.railColors = data.filter(i => i.category === 'RailColor');

  const visibleEngines = getVisibleEngines();
  const brands = [...new Set(visibleEngines.map(e => e.metadata?.brand).filter(Boolean))].sort();
  engineBrand.innerHTML = '<option value="" data-name="None">None</option>' +
    brands.map(b => `<option value="${b}">${b}</option>`).join('');

  if (revisionOrderId) {
    engineBrand.value = brands[0] || '';
    populateEngineHP(engineBrand.value);
  } else {
    applyDefaultEngineSelection();
  }
  engineBrand.addEventListener('change', () => {
    populateEngineHP(engineBrand.value);
    refreshSummary();
  });

  // Color sections (7 primary presets + per-section HSV wheel) are built at
  // module init and do not depend on the inventory fetch.

  // Keep the 3D view in sync with the default colors as soon as the options
  // load. Skip this in revision mode because loadRevisionOrder() applies the
  // saved colors itself.
  if (!revisionOrderId) {
    if (typeof setBodyColor === 'function') setBodyColor(hullColor);
    if (typeof setRoofColor === 'function') setRoofColor(roofColor);
    if (typeof setFloorColor === 'function') setFloorColor(deckColor);
    if (typeof setLowerHullColor === 'function') setLowerHullColor(lowerHullColor);
    if (typeof setRailColor === 'function') setRailColor(railColor);
  }

  refreshSummary();
}

// Smart Stability Analysis -------------------------------------------
// Single source of truth for the length-to-width safety check. Used by
// the safety panel, the submit-button gate and the submit guard so a
// configuration that fails the analysis can never be submitted.
function evaluateStability(len, wid) {
  const safeRatio = len / wid;
  let score = 92;
  if (safeRatio < 2.5 || safeRatio > 6) score = 55;
  else if (safeRatio < 3 || safeRatio > 5) score = 70;
  return { score, ratio: safeRatio };
}

function getSafetyBlockInfo(len, wid) {
  const { score } = evaluateStability(len, wid);
  const reasons = [];
  if (score < 80) reasons.push('stability');
  return { blocked: reasons.length > 0, reasons, score };
}

// Greys out the submit button while the configuration is unsafe. The
// button stays in the tab order on purpose (aria-disabled instead of the
// disabled attribute) so clicking/keypressing it can show the toast that
// explains why submission is blocked.
function updateSubmitGate(len, wid) {
  const submitReviewBtn = document.getElementById('submitReviewBtn');
  if (!submitReviewBtn) return;
  const { blocked } = getSafetyBlockInfo(len, wid);
  submitReviewBtn.classList.toggle('is-disabled', blocked);
  submitReviewBtn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  if (blocked) {
    submitReviewBtn.title = 'Unavailable — configuration is not safe yet. Adjust dimensions.';
  } else {
    submitReviewBtn.removeAttribute('title');
  }
}

function showSafetyBlockToasts(reasons) {
  const messages = [];
  if (reasons.includes('stability')) {
    messages.push({
      title: 'Unsafe Configuration',
      text: 'The current length-to-width ratio is outside the safe range for this boat. Adjust the dimensions until the Smart Stability Analysis shows SAFE & BALANCED (92%) before submitting.',
      variant: 'warning',
      duration: 3600,
    });
  }
  return messages.reduce(
    (chain, msg) => chain.then(() => showToast(msg)),
    Promise.resolve()
  );
}

// Dimension factors relative to the designed boat. Used both to stretch
// the 3D model and to keep the submitted preview consistent with what the
// customer configured.
function getDimensionFactors() {
  const specs = getBoatSpecs(getDraftBoatName());
  const refLen = parseSpecMeters(specs?.length) || 10;
  const refBeam = parseSpecMeters(specs?.breadth) || 2.8;
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const clamp = (v) => Math.min(1.2, Math.max(0.8, v));
  return {
    lengthFactor: clamp(len / refLen),
    beamFactor: clamp(wid / refBeam),
  };
}

function applyDimensionsTo3D() {
  const { lengthFactor, beamFactor } = getDimensionFactors();
  if (typeof setDimensions === 'function') setDimensions(lengthFactor, beamFactor);
}

function refreshSummary() {
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const engineVal = parseInt(engineHP.value);
  updateSummary(len, wid, engineVal);
  applyDimensionsTo3D();
}

function updateSummary(len, wid, engineVal) {
  const originalPrice = getOriginalPrice();
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const enginePrice = parseInt(engineHP.value);
  const { nameFee, flagFee } = computeNameFlagFees();
  // Prices come from the shared preset/wheel rules: each section default is
  // free, every other color (including arbitrary wheel colors) is charged
  // like a non-default preset.
  colorPrice = getSectionColorPrice('hull', hullColor);
  deckColorPrice = getSectionColorPrice('floor', deckColor);
  roofColorPrice = getSectionColorPrice('roof', roofColor);
  railColorPrice = getSectionColorPrice('rail', railColor);
  lowerHullColorPrice = getSectionColorPrice('lower-hull', lowerHullColor);
  const total = basePrice + enginePrice + colorPrice + deckColorPrice + roofColorPrice + lowerHullColorPrice + railColorPrice + nameFee + flagFee;

  totalPrice.textContent = '₱' + total.toLocaleString();

  const basePriceDisplay = document.getElementById('basePriceDisplay');
  if (basePriceDisplay) basePriceDisplay.textContent = '₱' + originalPrice.toLocaleString();
  const dimensExtensionRow = document.getElementById('dimensExtensionRow');
  const dimensExtensionDisplay = document.getElementById('dimensExtensionDisplay');
  if (extensionCost > 0) {
    dimensExtensionRow.style.display = 'flex';
    dimensExtensionDisplay.textContent = '₱' + extensionCost.toLocaleString();
  } else {
    dimensExtensionRow.style.display = 'none';
  }
  const enginePriceDisplay = document.getElementById('enginePriceDisplay');
  if (enginePriceDisplay) enginePriceDisplay.textContent = enginePrice > 0 ? '₱' + enginePrice.toLocaleString() : 'Included';
  const nameFeeRow = boatNameRow;
  if (nameFeeRow) nameFeeRow.style.display = nameFee > 0 ? 'flex' : 'none';
  if (boatNameDisplay) boatNameDisplay.textContent = '₱' + NAME_LETTERING_PRICE.toLocaleString();
  const flagFeeRow = flagRow;
  if (flagFeeRow) flagFeeRow.style.display = flagFee > 0 ? 'flex' : 'none';
  if (flagDisplay) flagDisplay.textContent = '₱' + FLAG_PRICE.toLocaleString();
  const colorPriceDisplay = document.getElementById('colorPriceDisplay');
  if (colorPriceDisplay) {
    colorPriceDisplay.textContent = isDefaultBodyColor(hullColor)
      ? 'Default'
      : presetNameFor(hullColor) + (colorPrice > 0 ? ' ₱' + colorPrice.toLocaleString() : '');
  }

  const roofColorPriceDisplay = document.getElementById('roofColorPriceDisplay');
  if (roofColorPriceDisplay) {
    roofColorPriceDisplay.textContent = isRoofDefault(roofColor)
      ? 'Default Roof'
      : presetNameFor(roofColor) + (roofColorPrice > 0 ? ' ₱' + roofColorPrice.toLocaleString() : '');
  }
  const floorColorPriceDisplay = document.getElementById('floorColorPriceDisplay');
  if (floorColorPriceDisplay) {
    floorColorPriceDisplay.textContent = isFloorDefault(deckColor)
      ? 'Default Floor'
      : presetNameFor(deckColor) + (deckColorPrice > 0 ? ' ₱' + deckColorPrice.toLocaleString() : '');
  }
  const lowerHullColorPriceDisplay = document.getElementById('lowerHullColorPriceDisplay');
  if (lowerHullColorPriceDisplay) {
    lowerHullColorPriceDisplay.textContent = isDefaultLowerHullColor(lowerHullColor)
      ? 'Default'
      : presetNameFor(lowerHullColor) + (lowerHullColorPrice > 0 ? ' ₱' + lowerHullColorPrice.toLocaleString() : '');
  }
  const railColorPriceDisplay = document.getElementById('railColorPriceDisplay');
  if (railColorPriceDisplay) {
    railColorPriceDisplay.textContent = isDefaultRailColor(railColor)
      ? 'Default Rail'
      : presetNameFor(railColor) + (railColorPrice > 0 ? ' ₱' + railColorPrice.toLocaleString() : '');
  }

  const stability = evaluateStability(len, wid);
  const score = stability.score;

  const safetyHeading = safetyBox.querySelector('h3');
  const safetyText = safetyBox.querySelector('p');
  const scoreCircle = safetyBox.querySelector('.score-circle');

  if (score >= 80) {
    safetyHeading.textContent = 'SAFE & BALANCED';
    safetyHeading.style.color = '#16a34a';
    safetyText.textContent = 'Great! Your configuration is within safe limits and ready for review.';
    scoreCircle.style.borderColor = '#22c55e';
  } else if (score >= 60) {
    safetyHeading.textContent = 'CAUTION — SUBMISSION BLOCKED';
    safetyHeading.style.color = '#ca8a04';
    safetyText.textContent = 'This length-to-width ratio is outside the recommended safe range. Submission is disabled — adjust the dimensions until it returns to SAFE & BALANCED.';
    scoreCircle.style.borderColor = '#eab308';
  } else {
    safetyHeading.textContent = 'UNSTABLE — SUBMISSION BLOCKED';
    safetyHeading.style.color = '#dc2626';
    safetyText.textContent = 'Warning: this configuration is unsafe for this boat. Submission is disabled — adjust the length and width until the analysis shows SAFE & BALANCED.';
    scoreCircle.style.borderColor = '#ef4444';
  }
  scoreCircle.textContent = score + '%';

  updateSubmitGate(len, wid);
}

lengthRange.addEventListener('input', () => {
  lengthValue.textContent = parseFloat(lengthRange.value) + 'm';
  refreshSummary();
});

widthRange.addEventListener('input', () => {
  widthValue.textContent = parseFloat(widthRange.value) + 'm';
  refreshSummary();
});

engineHP.addEventListener('change', refreshSummary);
  
  


const threePlayBtn = document.getElementById('threePlayBtn');

function updateThreePlayButton(rotating) {
  if (!threePlayBtn) return;
  threePlayBtn.innerHTML = rotating ? '⏸ Pause 360°' : '▶ Rotate 360°';
  threePlayBtn.setAttribute('aria-pressed', rotating ? 'true' : 'false');
}

setAutoRotateListener(updateThreePlayButton);

function toggleThreeRotation() {
  const rotating = rotateThree();
  updateThreePlayButton(rotating);
}

threePlayBtn?.addEventListener('click', () => {
  toggleThreeRotation();
});

document.getElementById('rotateBtn')?.addEventListener('click', () => {
  toggleThreeRotation();
});

document.getElementById('zoomInBtn')?.addEventListener('click', () => {
  zoomThree(1);
});

document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
  zoomThree(-1);
});

document.getElementById('resetBtn')?.addEventListener('click', () => {
  resetThree();
  updateThreePlayButton(false);
});

document.querySelector('.reset-btn').addEventListener('click', () => {
  applyBoatSpecDefaults();
  applyDefaultEngineSelection();
  // Reset boat name
  if (boatNameText) boatNameText.value = '';
  if (boatNameFont) boatNameFont.value = 'Impact';
  selectedNameColor = '#ffffff';
  boatNameColorsBox?.querySelectorAll('.name-swatch').forEach(el => el.classList.toggle('active', el.dataset.hex === '#ffffff'));
  document.querySelectorAll('input[name="namePlacement"]').forEach(el => { el.checked = el.value === 'sides'; });
  // Reset custom flag
  uploadedFlagImage = '';
  if (flagFile) flagFile.value = '';
  if (flagPreview) { flagPreview.removeAttribute('src'); flagPreview.style.display = 'none'; }
  if (flagUploadBox) flagUploadBox.style.display = 'none';
  if (flagPhPreview) flagPhPreview.style.display = 'none';
  document.querySelectorAll('input[name="flagType"]').forEach(el => { el.checked = el.value === 'none'; });
  document.querySelectorAll('input[name="flagPlacement"]').forEach(el => { el.checked = el.value === 'stern'; });
  resetThree();
  updateThreePlayButton(false);
  hullColor = DEFAULT_BODY_HEX;
  deckColor = DEFAULT_FLOOR_HEX;
  roofColor = DEFAULT_ROOF_HEX;
  lowerHullColor = DEFAULT_LOWER_HULL_HEX;
  railColor = DEFAULT_RAIL_HEX;
  setBackgroundChoice(DEFAULT_BACKGROUND_HEX);
  COLOR_SECTIONS.forEach(section => {
    const panel = document.getElementById('wheelPanel-' + section.key);
    const toggle = document.querySelector(`.wheel-toggle[data-wheel="${section.key}"]`);
    if (panel) panel.hidden = true;
    if (toggle) {
      toggle.classList.remove('active', 'open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    const wheel = wheelControls[section.key];
    if (wheel) wheel.setHex(section.defaultHex);
    section.apply3D(section.defaultHex);
  });
  applyNameFlagTo3D();
  updateColorPreview();
  refreshSummary();
});

document.getElementById('saveQuoteBtn')?.addEventListener('click', () => {
  const nameState = getBoatNameState();
  const flagState = getFlagState();
  const { nameFee, flagFee } = computeNameFlagFees();
  const enginePrice = parseInt(engineHP.value);
  const originalPrice = getOriginalPrice();
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const qDp = getSectionColorPrice('floor', deckColor);
  const qRP = getSectionColorPrice('roof', roofColor);
  const qRp = getSectionColorPrice('rail', railColor);
  const qLHp = getSectionColorPrice('lower-hull', lowerHullColor);
  colorPrice = getSectionColorPrice('hull', hullColor);
  const total = basePrice + enginePrice + colorPrice + qDp + qRP + qLHp + qRp + nameFee + flagFee;

  const engineBrandName = engineBrand.value || '';
  const engineHPText = engineHP.selectedOptions[0]?.textContent || '';
  const engineDisplayName = engineBrandName && engineHPText && engineHPText !== 'None' ? engineBrandName + ' ' + engineHPText : 'None';

  const qHullName = isDefaultBodyColor(hullColor) ? 'Default' : presetNameFor(hullColor);
  const qLowerHullName = isDefaultLowerHullColor(lowerHullColor) ? 'Default' : presetNameFor(lowerHullColor);
  const qFloorName = isFloorDefault(deckColor) ? 'Default Floor' : presetNameFor(deckColor);
  const qRoofName = isRoofDefault(roofColor) ? 'Default Roof' : presetNameFor(roofColor);
  const qRailName = isDefaultRailColor(railColor) ? 'Default Rail' : presetNameFor(railColor);

  const items = [
    { name: 'Base Boat', amount: originalPrice }
  ];
  if (extensionCost > 0) {
    items.push({ name: 'Dimension Extension', amount: extensionCost });
  }
  items.push(
    { name: 'Engine: ' + engineDisplayName, amount: enginePrice }
  );
  if (nameFee > 0) {
    items.push({ name: 'Boat Name: ' + nameState.text + ' (' + nameState.placements.join(', ') + ')', amount: nameFee });
  }
  if (flagFee > 0) {
    items.push({ name: 'Custom Flag (' + (flagState.type === 'ph' ? 'Philippine Flag' : 'Custom Upload') + ') — ' + flagState.placements.join(', '), amount: flagFee });
  }
  if (colorPrice > 0) {
    items.push({ name: 'Hull Paint: ' + qHullName, amount: colorPrice });
  }
  if (qDp > 0) {
    items.push({ name: 'Floor Color: ' + qFloorName, amount: qDp });
  }
  if (qRP > 0) {
    items.push({ name: 'Roof Color: ' + qRoofName, amount: qRP });
  }
  if (qLHp > 0) {
    items.push({ name: 'Lower Hull Color: ' + qLowerHullName, amount: qLHp });
  }
  if (qRp > 0) {
    items.push({ name: 'Rail Color: ' + qRailName, amount: qRp });
  }

  const config = {
    length: lengthRange.value,
    width: widthRange.value,
    originalPrice: String(originalPrice),
    extensionCost: String(extensionCost),
    engineBrand: engineBrandName,
    engine: engineHP.value,
    engineItem: engineHP.selectedOptions[0]?.dataset?.id || '',
    engineName: engineDisplayName,
    boatName: nameState.text,
    boatNameFont: nameState.font,
    boatNameColor: nameState.color,
    boatNamePlacements: nameState.placements,
    boatNameFee: String(nameFee),
    flagType: flagState.type,
    flagImage: flagState.type === 'custom' ? uploadedFlagImage : '',
    flagPlacements: flagState.placements,
    flagFee: String(flagFee),
    color: hullColor,
    colorPrice: String(colorPrice),
    hullColorName: qHullName,
    deckColor: deckColor,
    deckColorPrice: String(qDp),
    deckColorName: isFloorDefault(deckColor) ? 'Default Deck' : presetNameFor(deckColor),
    floorColor: deckColor,
    floorColorName: qFloorName,
    roofColor: roofColor,
    roofColorPrice: String(qRP),
    roofColorName: qRoofName,
    lowerHullColor: lowerHullColor,
    lowerHullColorPrice: String(qLHp),
    lowerHullColorName: qLowerHullName,
    railColor: railColor,
    railColorPrice: String(qRp),
    railColorName: qRailName,
    totalPrice: '₱' + total.toLocaleString(),
    items: items,
    date: new Date().toISOString()
  };
  localStorage.setItem('boatConfig', JSON.stringify(config));
  alert('Configuration saved! Ready for quotation.');
});

let revisionOrderId = null;

(function checkRevisionMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "revision") {
    try {
      const encoded = params.get("order");
      revisionOrderId = atob(encoded);
      const revBtn = document.getElementById("submitReviewBtn");
      if (revBtn) revBtn.textContent = "Submit Revision";
      loadRevisionOrder(revisionOrderId);
    } catch (e) { console.error("Invalid revision param"); }
  }
})();

// Payment method is chosen once in the order flow (Step 4) and carried on
// the customBuildDraft / revision order — it is not editable here.

(function checkAccessControl() {
  if (revisionOrderId) return;
  let draft;
  try { draft = JSON.parse(localStorage.getItem('customBuildDraft')); } catch (e) { draft = null; }
  if (!draft || !draft.boatData || !draft.boatData.name) {
    const submitBtns = document.querySelectorAll('.submit-review-btn, .quote-btn');
    submitBtns.forEach(el => { if (el) el.style.display = 'none'; });

    const previewBanner = document.createElement('div');
    previewBanner.style.cssText = 'padding:16px;background:#2563eb;color:white;border-radius:12px;margin:16px;text-align:center;font-size:14px;';
    previewBanner.innerHTML = '<i class="fa-solid fa-eye"></i> Preview Mode — <a href="order.html" style="color:#fff;font-weight:700;">Place an order</a> to customize this boat.';
    document.querySelector('.left-sidebar').appendChild(previewBanner);

    const modelEl = document.getElementById('boatModelName');
    if (modelEl) modelEl.textContent = 'Boat Preview';
  }
})();



function updateLengthDisplay() {
  lengthValue.textContent = parseFloat(lengthRange.value) + 'm';
}
function updateWidthDisplay() {
  widthValue.textContent = parseFloat(widthRange.value) + 'm';
}
function updateColorPreview() {
  COLOR_SECTIONS.forEach(section => {
    const hex = section.getHex();
    const container = document.querySelector(section.containerSelector);
    let matchedPreset = false;
    if (container) {
      container.querySelectorAll('.color').forEach(c => {
        const on = sameColor(c.dataset.color, hex);
        c.classList.toggle('active', on);
        if (on) matchedPreset = true;
      });
    }
    // An arbitrary saved (e.g. wheel) color activates the section's Custom
    // toggle instead of any preset tile.
    const toggle = document.querySelector(`.wheel-toggle[data-wheel="${section.key}"]`);
    if (toggle) toggle.classList.toggle('active', !matchedPreset);
    const wheel = wheelControls[section.key];
    if (wheel) wheel.setHex(hex);
  });
}
async function loadRevisionOrder(orderId) {
  const { data } = await handleDbError(
    supabase.from("boat_orders").select("*").eq("orderId", orderId).single(),
    "Load revision order"
  );
  if (!data || !data.customConfig) return;
  const cfg = data.customConfig;
  const savedPaymentMethod = data.paymentMethod || "Full Payment";
  const draft = {
    boatData: { name: data.boatName?.replace(" (Custom)", ""), image: data.boatImage, price: cfg.originalPrice || data.boatPrice },
    buildType: "custom",
    paymentMethod: savedPaymentMethod,
    contractSchedule: data.contractSchedule,
    guidelineResponses: data.guidelineResponses || {},
    comments: data.guidelineComments || {}
  };
  localStorage.setItem("customBuildDraft", JSON.stringify(draft));
  localStorage.setItem("boatConfig", JSON.stringify(cfg));

  // Payment method stays fixed from when the order was first placed — it
  // rides along on the draft and is submitted unchanged.
  await waitForOptionsReady();

  if (cfg.length) { lengthRange.value = cfg.length; updateLengthDisplay(); }
  if (cfg.width) { widthRange.value = cfg.width; updateWidthDisplay(); }
  if (cfg.engineBrand) {
    engineBrand.value = cfg.engineBrand;
    populateEngineHP(cfg.engineBrand);
  }
  if (cfg.engineItem) {
    await delay(500);
    const opt = engineHP.querySelector(`option[data-id="${cfg.engineItem}"]`);
    if (opt) opt.selected = true;
  }
  // Re-apply saved boat name / flag (legacy configs without them just skip).
  if (cfg.boatName) {
    if (boatNameText) boatNameText.value = cfg.boatName;
    if (boatNameFont && cfg.boatNameFont) boatNameFont.value = cfg.boatNameFont;
    if (cfg.boatNameColor) {
      selectedNameColor = cfg.boatNameColor;
      boatNameColorsBox?.querySelectorAll('.name-swatch').forEach(el => el.classList.toggle('active', el.dataset.hex === cfg.boatNameColor));
    }
    const namePlacements = Array.isArray(cfg.boatNamePlacements) ? cfg.boatNamePlacements : ['sides'];
    document.querySelectorAll('input[name="namePlacement"]').forEach(el => { el.checked = namePlacements.includes(el.value); });
  }
  if (cfg.flagType && cfg.flagType !== 'none') {
    const flagRadio = document.querySelector('input[name="flagType"][value="' + cfg.flagType + '"]');
    if (flagRadio) flagRadio.checked = true;
    if (flagPhPreview) flagPhPreview.style.display = cfg.flagType === 'ph' ? 'flex' : 'none';
    if (flagUploadBox) flagUploadBox.style.display = cfg.flagType === 'custom' ? 'block' : 'none';
    if (cfg.flagType === 'custom' && cfg.flagImage) {
      uploadedFlagImage = cfg.flagImage;
      if (flagPreview) { flagPreview.src = cfg.flagImage; flagPreview.style.display = 'block'; }
    }
    const flagPlacements = Array.isArray(cfg.flagPlacements) ? cfg.flagPlacements : ['stern'];
    document.querySelectorAll('input[name="flagPlacement"]').forEach(el => { el.checked = flagPlacements.includes(el.value); });
  }
  applyNameFlagTo3D();
  hullColor = cfg.color || DEFAULT_BODY_HEX;
  deckColor = cfg.deckColor || cfg.floorColor || DEFAULT_FLOOR_HEX;
  roofColor = cfg.roofColor || DEFAULT_ROOF_HEX;
  lowerHullColor = cfg.lowerHullColor || DEFAULT_LOWER_HULL_HEX;
  railColor = cfg.railColor || DEFAULT_RAIL_HEX;
  COLOR_SECTIONS.forEach(section => section.apply3D(section.getHex()));
  updateColorPreview();
  refreshSummary();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForOptionsReady(maxMs = 3000) {
  const step = 100;
  for (let waited = 0; waited < maxMs; waited += step) {
    if (inventoryItems.engines.length) return;
    await delay(step);
  }
}

document.getElementById('submitReviewBtn').addEventListener('click', async () => {
  // Defense in depth: the button is greyed out while the configuration is
  // unsafe, but re-check here too so it can never be submitted unsafe.
  const gateLen = parseFloat(lengthRange.value);
  const gateWid = parseFloat(widthRange.value);
  const gate = getSafetyBlockInfo(gateLen, gateWid);
  if (gate.blocked) {
    await showSafetyBlockToasts(gate.reasons);
    return;
  }

  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const isRevision = !!revisionOrderId;
  if (!draft || !draft.boatData) {
    if (!isRevision) {
      await showToast({
        title: "No build session found",
        text: "Please start a custom build from the order page.",
        variant: "warning",
        duration: 1400,
      });
      window.location.href = 'home.html';
      return;
    }
  }

  const nameState = getBoatNameState();
  const flagState = getFlagState();
  const { nameFee, flagFee } = computeNameFlagFees();
  const originalPrice = getOriginalPrice();
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const enginePrice = parseInt(engineHP.value);
  const dp = getSectionColorPrice('floor', deckColor);
  const rfp = getSectionColorPrice('roof', roofColor);
  const rp = getSectionColorPrice('rail', railColor);
  const lhp = getSectionColorPrice('lower-hull', lowerHullColor);
  colorPrice = getSectionColorPrice('hull', hullColor);
  const total = basePrice + enginePrice + colorPrice + dp + rfp + lhp + rp + nameFee + flagFee;

  const engineBrandName = engineBrand.value || '';
  const engineHPText = engineHP.selectedOptions[0]?.textContent || '';
  const engineDisplayName = engineBrandName && engineHPText && engineHPText !== 'None' ? engineBrandName + ' ' + engineHPText : 'None';

  const hullName = isDefaultBodyColor(hullColor) ? 'Default' : presetNameFor(hullColor);
  const lowerHullName = isDefaultLowerHullColor(lowerHullColor) ? 'Default' : presetNameFor(lowerHullColor);
  const floorName = isFloorDefault(deckColor) ? 'Default Floor' : presetNameFor(deckColor);
  const roofName = isRoofDefault(roofColor) ? 'Default Roof' : presetNameFor(roofColor);
  const railName = isDefaultRailColor(railColor) ? 'Default Rail' : presetNameFor(railColor);

  const items = [
    { name: 'Base Boat', amount: originalPrice }
  ];
  if (extensionCost > 0) {
    items.push({ name: 'Dimension Extension', amount: extensionCost });
  }
  items.push(
    { name: 'Engine: ' + engineDisplayName, amount: enginePrice }
  );
  if (nameFee > 0) {
    items.push({ name: 'Boat Name: ' + nameState.text + ' (' + nameState.placements.join(', ') + ')', amount: nameFee });
  }
  if (flagFee > 0) {
    items.push({ name: 'Custom Flag (' + (flagState.type === 'ph' ? 'Philippine Flag' : 'Custom Upload') + ') — ' + flagState.placements.join(', '), amount: flagFee });
  }
  if (colorPrice > 0) {
    items.push({ name: 'Hull Paint: ' + hullName, amount: colorPrice });
  }
  if (dp > 0) {
    items.push({ name: 'Floor Color: ' + floorName, amount: dp });
  }
  if (rfp > 0) {
    items.push({ name: 'Roof Color: ' + roofName, amount: rfp });
  }
  if (lhp > 0) {
    items.push({ name: 'Lower Hull Color: ' + lowerHullName, amount: lhp });
  }
  if (rp > 0) {
    items.push({ name: 'Rail Color: ' + railName, amount: rp });
  }

  // Prefer a 3D render for the saved preview so the admin dashboard shows
  // The saved preview is a 3D snapshot of the boat. If WebGL is unavailable
  // the admin dashboard simply shows no preview image.
  let boatPreviewImage = '';
  try {
    boatPreviewImage = await captureThreePreview({
      hull: hullColor,
      body: hullColor,
      door: hullColor,
      roof: roofColor,
      deck: deckColor,
      floor: deckColor,
      lowerHull: lowerHullColor,
      rail: railColor,
    }, getDimensionFactors(), backgroundHex);
  } catch (e) {
    boatPreviewImage = '';
  }

  const config = {
    length: lengthRange.value,
    width: widthRange.value,
    engineBrand: engineBrandName,
    engine: String(enginePrice),
    engineItem: engineHP.selectedOptions[0]?.dataset?.id || '',
    engineName: engineDisplayName,
    boatName: nameState.text,
    boatNameFont: nameState.font,
    boatNameColor: nameState.color,
    boatNamePlacements: nameState.placements,
    boatNameFee: String(nameFee),
    flagType: flagState.type,
    flagImage: flagState.type === 'custom' ? uploadedFlagImage : '',
    flagPlacements: flagState.placements,
    flagFee: String(flagFee),
    color: hullColor,
    colorPrice: String(colorPrice),
    hullColorName: hullName,
    deckColor: deckColor,
    deckColorPrice: String(dp),
    deckColorName: isFloorDefault(deckColor) ? 'Default Deck' : presetNameFor(deckColor),
    floorColor: deckColor,
    floorColorName: floorName,
    roofColor: roofColor,
    roofColorPrice: String(rfp),
    roofColorName: roofName,
    lowerHullColor: lowerHullColor,
    lowerHullColorPrice: String(lhp),
    lowerHullColorName: lowerHullName,
    railColor: railColor,
    railColorPrice: String(rp),
    railColorName: railName,
    totalPrice: '₱' + total.toLocaleString(),
    items: items,
    originalPrice: String(originalPrice),
    extensionCost: String(extensionCost),
    boatPreviewImage: boatPreviewImage,
    date: new Date().toISOString()
  };

  const customerName = sessionStorage.getItem('customerName') || '';
  const customerEmail = sessionStorage.getItem('customerEmail') || '';
  const customerPhone = sessionStorage.getItem('customerPhone') || '';
  const priceNum = parseFloat(String(config.totalPrice).replace(/[^0-9.]/g, '')) || 0;
  const custPayMethod = draft?.paymentMethod || "Full Payment";

  if (isRevision) {
    const { error } = await supabase
      .from("boat_orders")
      .update({
        customConfig: config,
        boatPrice: config.totalPrice,
        status: "Under Review",
        orderPhase: "Awaiting Engineering Review",
        reviewFeedback: "",
        reviewStatus: "",
        progress: 0,
        remainingBalance: priceNum,
        updatedAt: new Date().toISOString()
      })
      .eq("orderId", revisionOrderId);
    if (error) { alert("Failed to submit revision: " + error.message); return; }
    sendEmailNotification({ type: "status_changed", recipient: customerEmail, data: { orderId: revisionOrderId, customerName, customerEmail, status: "Under Review", orderPhase: "Revision Submitted", progress: 0 } });
    sendEmailNotification({ type: "status_changed", recipient: ADMIN_EMAIL, data: { orderId: revisionOrderId, customerName, customerEmail, status: "Under Review", orderPhase: "Revision Submitted", progress: 0 } });
    localStorage.removeItem('customBuildDraft');
    localStorage.removeItem('boatConfig');
    await showToast({
      title: "Revision submitted",
      text: "Your revised design is now under engineering review.",
      duration: 1500,
    });
    window.location.href = 'home.html';
    return;
  }

  const order = {
    orderId: 'ORD-' + Date.now(),
    boatName: draft.boatData.name + ' (Custom)',
    boatImage: draft.boatData.image,
    boatPrice: config.totalPrice,
    buildTime: 'TBD (Under Review)',
    downpayment: 'TBD',
    paymentMethod: custPayMethod,
    customerName: customerName,
    customerEmail: customerEmail,
    customerPhone: customerPhone,
    customerAddress: '',
    validId: '',
    notes: 'Custom build submitted for engineering review.',
    status: 'Under Review',
    progress: 0,
    remainingBalance: priceNum,
    orderPhase: 'Awaiting Engineering Review',
    buildType: 'custom',
    customConfig: config,
    guidelineResponses: draft.guidelineResponses || {},
    guidelineComments: draft.comments || {},
    contractSchedule: draft.contractSchedule || null,
    reviewFeedback: '',
    reviewStatus: '',
    signature: draft.contractSchedule?.signature || '',
    createdAt: new Date().toISOString()
  };

  const { error } = await supabase.from("boat_orders").insert(order);
  if (error) { alert("Failed to submit: " + error.message); return; }

  sendEmailNotification({ type: "order_created", recipient: order.customerEmail, data: order });
  sendEmailNotification({ type: "order_created", recipient: ADMIN_EMAIL, data: order });

  localStorage.removeItem('customBuildDraft');
  localStorage.removeItem('boatConfig');

  await showToast({
    title: "Submitted for review",
    text: "You will be notified once the design has been evaluated.",
    duration: 1500,
  });
  window.location.href = 'home.html';
});

function loadBoatModelInfo() {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  if (draft?.boatData?.name) {
    const nameEl = document.getElementById('boatModelName');
    if (nameEl) nameEl.textContent = draft.boatData.name;
    const imgEl = document.getElementById('boatModelImage');
    if (imgEl && draft.boatData.image) {
      imgEl.src = draft.boatData.image;
    }
  }
}

loadBoatModelInfo();

// Build the color sections (7 primary presets + per-section HSV wheel)
// before anything else so the color UI renders even if the inventory fetch
// fails. Revision mode reapplies its saved colors afterwards.
setupWheelToggles();
COLOR_SECTIONS.forEach(section => {
  buildPresetSwatches(section, section.getHex());
});
buildBackgroundSwatches();
setBackgroundChoice(backgroundHex);
// The 3D viewer is the only preview; show it as soon as the module loads.
showThreeView();
applyBoatSpecDefaults();
loadOptions().then(() => refreshSummary()).catch(err => {
  console.error('loadOptions failed:', err);
  refreshSummary();
});
