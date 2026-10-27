import { supabase, handleDbError, sendEmailNotification, getCustomerIdentity, landingForRole } from "./supabase.js";
import { getBoatSpecs } from "./boatData.js";
import { showThreeView, setHullColor, setDeckColor, setRailColor, setBodyColor, setRoofColor, setDoorColor, rotateThree, zoomThree, resetThree } from "./boat3d.js";

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

  // Ensure 3D view state
  try {
    const { showThreeView } = await import('./boat3d.js?' + Date.now());
    if (is1950Boat()) {
      // Don't auto-show, let user click
    } else {
      showThreeView(false);
    }
  } catch (e) {}

const canvas = document.getElementById('boatCanvas');
const ctx = canvas.getContext('2d');

let rotationAngle = 0;
let zoomLevel = 1;
let currentView = 'exterior';
let hullColor = '#111827';
let deckColor = '#8B7355';
let railColor = '#C0C0C0';
let colorPrice = 0;
let deckColorPrice = 0;
let railColorPrice = 0;
let inventoryItems = { engines: [], seats: [], leds: [], colors: [], deckColors: [], railColors: [] };

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

function parseSpecPax(str) {
  const m = String(str || '').match(/(\d+)\s*passengers?/i);
  return m ? parseInt(m[1]) : null;
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

function getFitCapacity(len, wid) {
  const specs = getBoatSpecs(getDraftBoatName());
  const stdLength = parseSpecMeters(specs?.length);
  const stdBeam = parseSpecMeters(specs?.breadth);
  if (specs?.seatRows && specs?.seatsPerRow && stdLength && stdBeam) {
    const rows = Math.max(1, Math.floor((len / stdLength) * specs.seatRows + 1e-9));
    const perRow = Math.max(1, Math.floor((wid / stdBeam) * specs.seatsPerRow + 1e-9));
    return rows * perRow;
  }
  const stdPax = parseSpecPax(specs?.passengerCapacity);
  if (stdPax && stdLength && stdBeam) {
    return Math.max(1, Math.round(stdPax * (len * wid) / (stdLength * stdBeam)));
  }
  return Math.floor(8 + (len - 8) * 0.7);
}

function hasSeatLayout() {
  const specs = getBoatSpecs(getDraftBoatName());
  return !!(specs?.seatRows && specs?.seatsPerRow);
}

function refreshSeatAvailability(maxCap) {
  if (!hasSeatLayout()) return;
  const options = Array.from(seatSelect.options);
  options.forEach(opt => {
    const cap = parseInt(opt.dataset.capacity || 0);
    const overCapacity = cap > maxCap;
    opt.disabled = overCapacity;
    if (overCapacity) opt.title = 'Does not fit current dimensions (max ' + maxCap + ')';
    else opt.removeAttribute('title');
  });
  const selected = seatSelect.selectedOptions[0];
  const selectedCap = parseInt(selected?.dataset?.capacity || 0);
  if (selectedCap <= maxCap) return;
  const fitting = options.filter(o => !o.disabled)
    .map(o => ({ opt: o, cap: parseInt(o.dataset.capacity || 0) }))
    .sort((a, b) => b.cap - a.cap);
  seatSelect.value = (fitting[0]?.opt || options[0]).value;
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

function applyDefaultSeatSelection() {
  if (revisionOrderId) return;
  const name = getDraftBoatName();
  const specs = getBoatSpecs(name);
  const stdPax = parseSpecPax(specs?.passengerCapacity);
  let target = null;
  if (stdPax) {
    target = inventoryItems.seats.find(s => s.metadata?.capacity === stdPax)
      || inventoryItems.seats.reduce((best, s) => {
        const cap = s.metadata?.capacity || 0;
        const bestCap = best?.metadata?.capacity || 0;
        return cap <= stdPax && cap > bestCap ? s : best;
      }, null);
  }
  if (!target && inventoryItems.seats.length > 0) target = inventoryItems.seats[0];
  if (!target) return;
  const opt = seatSelect.querySelector(`option[data-id="${target.id}"]`);
  if (opt) seatSelect.value = opt.value;
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
const seatSelect = document.getElementById('seatSelect');
const ledSelect = document.getElementById('ledSelect');
const totalPrice = document.getElementById('totalPrice');
const safetyBox = document.getElementById('safetyBox');
const recommendedSeats = document.getElementById('recommendedSeats');
const currentSeats = document.getElementById('currentSeats');
const remainingWeight = document.getElementById('remainingWeight');

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
  { name: '5 Seats', category: 'Seats', stock: 99, price: 32500, metadata: { capacity: 5, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '8 Seats', category: 'Seats', stock: 99, price: 52000, metadata: { capacity: 8, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '10 Seats', category: 'Seats', stock: 99, price: 65000, metadata: { capacity: 10, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '12 Seats', category: 'Seats', stock: 99, price: 78000, metadata: { capacity: 12, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '15 Seats', category: 'Seats', stock: 99, price: 97500, metadata: { capacity: 15, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '20 Seats', category: 'Seats', stock: 99, price: 130000, metadata: { capacity: 20, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '65 Seats', category: 'Seats', stock: 99, price: 422500, metadata: { capacity: 65, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '180 Seats', category: 'Seats', stock: 99, price: 1170000, metadata: { capacity: 180, optionType: 'seats', perSeatPrice: 6500 } },
  { name: 'Blue LED', category: 'LED', stock: 20, price: 15000, metadata: { ledType: 'blue', optionType: 'led' } },
  { name: 'RGB LED', category: 'LED', stock: 15, price: 25000, metadata: { ledType: 'rgb', optionType: 'led' } },
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
  const cats = ['Engine', 'Seats', 'LED', 'Color', 'DeckColor', 'RailColor'];
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
  inventoryItems.seats = data.filter(i => i.category === 'Seats').sort((a, b) => (a.metadata?.capacity || 0) - (b.metadata?.capacity || 0));
  inventoryItems.leds = data.filter(i => i.category === 'LED').sort((a, b) => a.price - b.price);
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
    drawBoat();
  });

  seatSelect.innerHTML = '<option value="0" data-capacity="0" data-id="" data-name="None">None</option>' +
    inventoryItems.seats.map(s =>
      `<option value="${s.price}" data-capacity="${s.metadata?.capacity || 8}" data-id="${s.id}" data-name="${s.name}">${s.name}</option>`
    ).join('');

  applyDefaultSeatSelection();

  ledSelect.innerHTML = '<option value="0" data-id="" data-name="None">None</option>' +
    inventoryItems.leds.map(l =>
      `<option value="${l.price}" data-id="${l.id}" data-name="${l.name}">${l.name}</option>`
    ).join('');

  const colorContainer = document.querySelector('.colors.hull-colors');
  if (colorContainer && inventoryItems.colors.length > 0) {
    const defaultHullItem = inventoryItems.colors.find(c => c.metadata?.isDefault);
    const otherHullItems = inventoryItems.colors.filter(c => !c.metadata?.isDefault);
    let html = '';
    if (defaultHullItem) {
      html += `<div class="color default active" data-color="${defaultHullItem.metadata?.hex || '#111827'}" data-id="${defaultHullItem.id}" data-price="${defaultHullItem.price || 0}" data-default="true" style="background:${defaultHullItem.metadata?.hex || '#111827'}" title="${defaultHullItem.name}"></div>`;
    }
    html += otherHullItems.map((c, i) =>
      `<div class="color" data-color="${c.metadata?.hex || '#2563eb'}" data-id="${c.id}" data-price="${c.price || 0}" style="background:${c.metadata?.hex || '#2563eb'}" title="${c.name}"></div>`
    ).join('');
    colorContainer.innerHTML = html;
    hullColor = defaultHullItem?.metadata?.hex || '#111827';
    colorPrice = 0;
    colorContainer.querySelectorAll('.color').forEach(el => {
      el.addEventListener('click', () => {
        colorContainer.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        hullColor = el.dataset.color;
        colorPrice = el.dataset.default === 'true' ? 0 : getHullColorPricing();
        const cname = el.title || '';
        if (/body/i.test(cname)) { if (typeof setBodyColor === 'function') setBodyColor(hullColor); else setHullColor(hullColor); }
        else if (/door/i.test(cname)) { if (typeof setDoorColor === 'function') setDoorColor(hullColor); }
        else { setHullColor(hullColor); }
        drawBoat();
      });
    });
  }

  const deckColorContainer = document.querySelector('.colors.deck-colors');
  if (deckColorContainer && inventoryItems.deckColors.length > 0) {
    const defaultDeckItem = inventoryItems.deckColors.find(c => c.metadata?.isDefault);
    const otherDeckItems = inventoryItems.deckColors.filter(c => !c.metadata?.isDefault);
    let html = '';
    if (defaultDeckItem) {
      html += `<div class="color active" data-color="${defaultDeckItem.metadata?.hex || '#8B7355'}" data-id="${defaultDeckItem.id}" data-price="${defaultDeckItem.price || 0}" data-default="true" style="background:${defaultDeckItem.metadata?.hex || '#8B7355'}" title="${defaultDeckItem.name}"></div>`;
    }
    html += otherDeckItems.map(c =>
      `<div class="color" data-color="${c.metadata?.hex || '#8B7355'}" data-id="${c.id}" data-price="${c.price || 0}" style="background:${c.metadata?.hex || '#8B7355'}" title="${c.name}"></div>`
    ).join('');
    deckColorContainer.innerHTML = html;
    deckColor = defaultDeckItem?.metadata?.hex || '#8B7355';
    deckColorContainer.querySelectorAll('.color').forEach(el => {
      el.addEventListener('click', () => {
        deckColorContainer.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        deckColor = el.dataset.color;
        const dname = el.title || '';
        if (/roof/i.test(dname)) { if (typeof setRoofColor === 'function') setRoofColor(deckColor); }
        else if (/deck/i.test(dname) || /floor/i.test(dname) || /teak/i.test(dname)) { setDeckColor(deckColor); }
        else { setDeckColor(deckColor); }
        drawBoat();
      });
    });
  }

  const railColorContainer = document.querySelector('.colors.rail-colors');
  if (railColorContainer && inventoryItems.railColors.length > 0) {
    const defaultRailItem = inventoryItems.railColors.find(c => c.metadata?.isDefault);
    const otherRailItems = inventoryItems.railColors.filter(c => !c.metadata?.isDefault);
    let html = '';
    if (defaultRailItem) {
      html += `<div class="color active" data-color="${defaultRailItem.metadata?.hex || '#C0C0C0'}" data-id="${defaultRailItem.id}" data-price="${defaultRailItem.price || 0}" data-default="true" style="background:${defaultRailItem.metadata?.hex || '#C0C0C0'}" title="${defaultRailItem.name}"></div>`;
    }
    html += otherRailItems.map(c =>
      `<div class="color" data-color="${c.metadata?.hex || '#C0C0C0'}" data-id="${c.id}" data-price="${c.price || 0}" style="background:${c.metadata?.hex || '#C0C0C0'}" title="${c.name}"></div>`
    ).join('');
    railColorContainer.innerHTML = html;
    railColor = defaultRailItem?.metadata?.hex || '#C0C0C0';
    railColorContainer.querySelectorAll('.color').forEach(el => {
      el.addEventListener('click', () => {
        railColorContainer.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        railColor = el.dataset.color;
        setRailColor(railColor);
        drawBoat();
      });
    });
  }
  drawBoat();
}

function resizeCanvas() {
  const wrapper = canvas.parentElement;
  const rect = wrapper.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  drawBoat();
}

function drawBoat() {
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const maxCap = getFitCapacity(len, wid);
  refreshSeatAvailability(maxCap);
  const engineVal = parseInt(engineHP.value);
  const seatOpt = seatSelect.selectedOptions[0];
  const seats = parseInt(seatOpt?.dataset?.capacity || 8);
  const ledVal = parseInt(ledSelect.value);

  ctx.save();
  const cx = w / 2;
  const cy = h / 2;
  ctx.translate(cx, cy);
  ctx.scale(zoomLevel, zoomLevel);
  ctx.rotate(rotationAngle);

  const boatLen = len * 15;
  const boatWid = wid * 15;

  drawWater(boatLen, boatWid);
  if (currentView === 'exterior') drawExterior(boatLen, boatWid);
  else if (currentView === 'interior') drawInterior(boatLen, boatWid);
  else if (currentView === 'top') drawTopView(boatLen, boatWid);
  else if (currentView === 'rear') drawRearView(boatLen, boatWid);
  else if (currentView === 'front') drawFrontView(boatLen, boatWid);
  else if (currentView === 'perspective') drawPerspectiveView(boatLen, boatWid);

  ctx.restore();

  updateSummary(len, wid, engineVal, seats, ledVal, maxCap);
}

function drawWater(boatLen, boatWid) {
  const gradient = ctx.createRadialGradient(0, 40, 10, 0, 40, boatLen * 0.8);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, boatLen * 0.3, boatLen * 0.7, boatLen * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawExterior(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;

  ctx.save();

  ctx.shadowColor = 'rgba(0,0,0,0.1)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 5;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, hw * 0.3);
  ctx.quadraticCurveTo(-hl * 0.6, hw * 1.2, 0, hw);
  ctx.quadraticCurveTo(hl * 0.6, hw * 1.2, hl, hw * 0.3);
  ctx.quadraticCurveTo(hl * 0.7, -hw * 0.3, hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(0, -hw, -hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(-hl * 0.7, -hw * 0.3, -hl, hw * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'transparent';

  ctx.fillStyle = deckColor;
  ctx.strokeStyle = darkenColor(deckColor, 15);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-hl * 0.15, -hw * 0.7);
  ctx.quadraticCurveTo(0, -hw * 0.8, hl * 0.15, -hw * 0.7);
  ctx.quadraticCurveTo(hl * 0.5, -hw * 0.2, hl * 0.7, hw * 0.1);
  ctx.lineTo(-hl * 0.7, hw * 0.1);
  ctx.quadraticCurveTo(-hl * 0.5, -hw * 0.2, -hl * 0.15, -hw * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = darkenColor(hullColor, 40);
  ctx.strokeStyle = darkenColor(hullColor, 60);
  ctx.lineWidth = 1.5;

  const cabW = boatWid * 0.5;
  const cabH = boatLen * 0.18;
  const cabX = -boatLen * 0.05;
  const cabY = -boatWid * 0.3;

  ctx.beginPath();
  ctx.roundRect(cabX - cabW / 2, cabY - cabH, cabW, cabH, 4);
  ctx.fill();
  ctx.stroke();

  const winGrad = ctx.createLinearGradient(cabX - cabW / 2 + 4, 0, cabX + cabW / 2 - 4, 0);
  winGrad.addColorStop(0, 'rgba(147, 197, 253, 0.7)');
  winGrad.addColorStop(0.5, 'rgba(191, 219, 254, 0.9)');
  winGrad.addColorStop(1, 'rgba(147, 197, 253, 0.7)');

  const winW = cabW * 0.7;
  const winH = cabH * 0.55;
  ctx.fillStyle = winGrad;
  ctx.beginPath();
  ctx.roundRect(cabX - winW / 2, cabY - cabH + 6, winW, winH, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = railColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-hl * 0.65, hw * 0.25);
  ctx.lineTo(-hl * 0.65, -hw * 0.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hl * 0.65, hw * 0.25);
  ctx.lineTo(hl * 0.65, -hw * 0.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-hl * 0.65, -hw * 0.15);
  ctx.quadraticCurveTo(0, -hw * 0.35, hl * 0.65, -hw * 0.15);
  ctx.stroke();

  const engX = boatLen * 0.42;
  const engY = boatWid * 0.2;
  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.ellipse(engX, engY, boatWid * 0.15, boatWid * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.ellipse(engX + boatWid * 0.12, engY, boatWid * 0.05, boatWid * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawInterior(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 30);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, hw * 0.3);
  ctx.quadraticCurveTo(-hl * 0.6, hw * 1.2, 0, hw);
  ctx.quadraticCurveTo(hl * 0.6, hw * 1.2, hl, hw * 0.3);
  ctx.quadraticCurveTo(hl * 0.7, -hw * 0.3, hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(0, -hw, -hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(-hl * 0.7, -hw * 0.3, -hl, hw * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = deckColor;
  ctx.strokeStyle = darkenColor(deckColor, 10);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-hl * 0.05, -hw * 0.6);
  ctx.quadraticCurveTo(0, -hw * 0.7, hl * 0.05, -hw * 0.6);
  ctx.quadraticCurveTo(hl * 0.4, -hw * 0.1, hl * 0.55, hw * 0.15);
  ctx.lineTo(-hl * 0.55, hw * 0.15);
  ctx.quadraticCurveTo(-hl * 0.4, -hw * 0.1, -hl * 0.05, -hw * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const seatOpt = seatSelect.selectedOptions[0];
  const seats = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatRows = Math.min(seats, 15);
  const rowCount = Math.ceil(seatRows / 2);
  const seatSpacing = (boatLen * 0.6) / rowCount;

  for (let i = 0; i < rowCount; i++) {
    const sx = -boatLen * 0.2 + i * seatSpacing;
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.roundRect(sx - 6, -hw * 0.1, 12, 8, 3);
    ctx.fill();
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.roundRect(sx - 6, hw * 0.05, 12, 8, 3);
    ctx.fill();
  }

  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.roundRect(-15, -10, 30, 16, 4);
  ctx.fill();
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(0, -2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('INTERIOR LAYOUT', 0, hw * 0.7);
}

function drawTopView(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, 0);
  ctx.quadraticCurveTo(-hl * 0.7, -hw, 0, -hw);
  ctx.quadraticCurveTo(hl * 0.7, -hw, hl, 0);
  ctx.quadraticCurveTo(hl * 0.7, hw, 0, hw);
  ctx.quadraticCurveTo(-hl * 0.7, hw, -hl, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = deckColor;
  ctx.strokeStyle = darkenColor(deckColor, 15);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-boatLen * 0.08, -boatWid * 0.35, boatLen * 0.16, boatWid * 0.7, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
  ctx.beginPath();
  ctx.roundRect(-boatLen * 0.05, -boatWid * 0.28, boatLen * 0.1, boatWid * 0.56, 3);
  ctx.fill();

  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.ellipse(hl * 0.35, 0, boatWid * 0.1, boatWid * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TOP VIEW', 0, boatWid * 0.85);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px Poppins, sans-serif';
  ctx.fillText('L: ' + lengthRange.value + 'm x W: ' + widthRange.value + 'm', 0, boatWid * 0.95);
}

function drawRearView(boatLen, boatWid) {
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hw, boatWid * 0.3);
  ctx.quadraticCurveTo(-hw * 0.7, boatWid * 0.1, -hw * 0.6, -boatWid * 0.2);
  ctx.quadraticCurveTo(-hw * 0.3, -boatWid * 0.5, 0, -boatWid * 0.55);
  ctx.quadraticCurveTo(hw * 0.3, -boatWid * 0.5, hw * 0.6, -boatWid * 0.2);
  ctx.quadraticCurveTo(hw * 0.7, boatWid * 0.1, hw, boatWid * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = darkenColor(hullColor, 40);
  const cabW = boatWid * 0.45;
  const cabH = boatWid * 0.25;
  ctx.beginPath();
  ctx.roundRect(-cabW / 2, -boatWid * 0.35 - cabH, cabW, cabH, 3);
  ctx.fill();
  ctx.strokeStyle = darkenColor(hullColor, 60);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
  ctx.beginPath();
  ctx.roundRect(-cabW / 2 + 3, -boatWid * 0.35 - cabH + 3, cabW - 6, cabH * 0.5, 2);
  ctx.fill();

  ctx.fillStyle = '#374151';
  const engSpacing = boatWid * 0.15;
  ctx.beginPath();
  ctx.ellipse(-engSpacing, boatWid * 0.1, boatWid * 0.06, boatWid * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(engSpacing, boatWid * 0.1, boatWid * 0.06, boatWid * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('REAR VIEW', 0, boatWid * 0.65);
}

function drawFrontView(boatLen, boatWid) {
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hw * 0.6, boatWid * 0.25);
  ctx.quadraticCurveTo(-hw * 0.5, boatWid * 0.05, -hw * 0.45, -boatWid * 0.15);
  ctx.quadraticCurveTo(-hw * 0.25, -boatWid * 0.45, 0, -boatWid * 0.5);
  ctx.quadraticCurveTo(hw * 0.25, -boatWid * 0.45, hw * 0.45, -boatWid * 0.15);
  ctx.quadraticCurveTo(hw * 0.5, boatWid * 0.05, hw * 0.6, boatWid * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = deckColor;
  ctx.strokeStyle = darkenColor(deckColor, 20);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.4, -boatWid * 0.1);
  ctx.quadraticCurveTo(0, -boatWid * 0.35, hw * 0.4, -boatWid * 0.1);
  ctx.lineTo(hw * 0.35, -boatWid * 0.05);
  ctx.quadraticCurveTo(0, -boatWid * 0.25, -hw * 0.35, -boatWid * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = darkenColor(hullColor, 40);
  const cabW = boatWid * 0.45;
  const cabH = boatWid * 0.22;
  ctx.beginPath();
  ctx.roundRect(-cabW / 2, -boatWid * 0.3 - cabH, cabW, cabH, 3);
  ctx.fill();
  ctx.strokeStyle = darkenColor(hullColor, 60);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
  ctx.beginPath();
  ctx.roundRect(-cabW / 2 + 3, -boatWid * 0.3 - cabH + 3, cabW - 6, cabH * 0.5, 2);
  ctx.fill();

  ctx.strokeStyle = railColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.55, boatWid * 0.2);
  ctx.lineTo(-hw * 0.55, -boatWid * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hw * 0.55, boatWid * 0.2);
  ctx.lineTo(hw * 0.55, -boatWid * 0.05);
  ctx.stroke();

  ctx.strokeStyle = railColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.55, -boatWid * 0.05);
  ctx.quadraticCurveTo(0, -boatWid * 0.2, hw * 0.55, -boatWid * 0.05);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FRONT VIEW', 0, boatWid * 0.65);
}

function drawPerspectiveView(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;
  const perspective = 0.35;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, hw * 0.35);
  ctx.quadraticCurveTo(-hl * 0.65, hw * 1.1, 0, hw * 0.95);
  ctx.quadraticCurveTo(hl * 0.65, hw * 1.1, hl, hw * 0.35);
  ctx.quadraticCurveTo(hl * 0.75, -hw * 0.25, hl * 0.35, -hw * 0.75);
  ctx.quadraticCurveTo(0, -hw * 0.9, -hl * 0.35, -hw * 0.75);
  ctx.quadraticCurveTo(-hl * 0.75, -hw * 0.25, -hl, hw * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = deckColor;
  ctx.strokeStyle = darkenColor(deckColor, 15);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-hl * 0.65, hw * 0.15);
  ctx.quadraticCurveTo(-hl * 0.35, -hw * 0.55, 0, -hw * 0.65);
  ctx.quadraticCurveTo(hl * 0.35, -hw * 0.55, hl * 0.65, hw * 0.15);
  ctx.lineTo(hl * 0.55, hw * 0.2);
  ctx.quadraticCurveTo(0, -hw * 0.45, -hl * 0.55, hw * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = darkenColor(hullColor, 40);
  ctx.strokeStyle = darkenColor(hullColor, 60);
  ctx.lineWidth = 1.5;
  const cabW = boatWid * 0.42;
  const cabH = boatLen * 0.16;
  const cabX = -boatLen * 0.03;
  const cabY = -boatWid * 0.28;
  ctx.beginPath();
  ctx.roundRect(cabX - cabW / 2, cabY - cabH, cabW, cabH, 4);
  ctx.fill();
  ctx.stroke();

  const winGrad = ctx.createLinearGradient(cabX - cabW / 2 + 4, 0, cabX + cabW / 2 - 4, 0);
  winGrad.addColorStop(0, 'rgba(147, 197, 253, 0.7)');
  winGrad.addColorStop(0.5, 'rgba(191, 219, 254, 0.9)');
  winGrad.addColorStop(1, 'rgba(147, 197, 253, 0.7)');
  const winW = cabW * 0.7;
  const winH = cabH * 0.5;
  ctx.fillStyle = winGrad;
  ctx.beginPath();
  ctx.roundRect(cabX - winW / 2, cabY - cabH + 5, winW, winH, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = railColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-hl * 0.6, hw * 0.3);
  ctx.lineTo(-hl * 0.6, -hw * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hl * 0.6, hw * 0.3);
  ctx.lineTo(hl * 0.6, -hw * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-hl * 0.6, -hw * 0.1);
  ctx.quadraticCurveTo(0, -hw * 0.35, hl * 0.6, -hw * 0.1);
  ctx.stroke();

  const seatOpt = seatSelect.selectedOptions[0];
  const seats = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatRows = Math.min(Math.ceil(seats / 2), 10);
  const seatSpacing = (boatLen * 0.45) / seatRows;
  for (let i = 0; i < seatRows; i++) {
    const sx = -boatLen * 0.15 + i * seatSpacing;
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.roundRect(sx - 4, -hw * 0.05, 8, 6, 2);
    ctx.fill();
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.roundRect(sx - 4, hw * 0.08, 8, 6, 2);
    ctx.fill();
  }

  ctx.fillStyle = '#374151';
  const engX = hl * 0.4;
  const engY = hw * 0.22;
  ctx.beginPath();
  ctx.ellipse(engX, engY, boatWid * 0.12, boatWid * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.ellipse(engX + boatWid * 0.1, engY, boatWid * 0.04, boatWid * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  const ledVal = parseInt(ledSelect.value);
  if (ledVal > 0) {
    const ledOption = ledSelect.selectedOptions[0];
    const ledName = ledOption?.dataset?.name || '';
    const isRGB = ledName.toLowerCase().includes('rgb');
    const ledGlow = isRGB ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)';
    ctx.shadowColor = ledGlow;
    ctx.shadowBlur = 15;
    ctx.strokeStyle = isRGB ? 'rgba(168, 85, 247, 0.6)' : 'rgba(59, 130, 246, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-hl * 0.58, hw * 0.28);
    ctx.lineTo(hl * 0.58, hw * 0.28);
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('3D PERSPECTIVE', 0, boatWid * 0.85);
}

function updateSummary(len, wid, engineVal, seats, ledVal, maxCap) {
  const originalPrice = getOriginalPrice();
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const enginePrice = parseInt(engineHP.value);
  const ledPrice = parseInt(ledSelect.value);
  const seatOpt = seatSelect.selectedOptions[0];
  const seatCapacity = parseInt(seatOpt?.dataset?.capacity || seats);
  const seatTotal = parseInt(seatSelect.value) || 0;
  const perSeatPrice = seatCapacity > 0 ? Math.round(seatTotal / seatCapacity) : 0;
  const deckOpt = inventoryItems.deckColors.find(c => c.metadata?.hex === deckColor && !c.metadata?.isDefault) || inventoryItems.deckColors.find(c => c.metadata?.hex === deckColor);
  const railOpt = inventoryItems.railColors.find(c => c.metadata?.hex === railColor && !c.metadata?.isDefault) || inventoryItems.railColors.find(c => c.metadata?.hex === railColor);
  deckColorPrice = deckOpt?.price || 0;
  railColorPrice = railOpt?.price || 0;
  const total = basePrice + enginePrice + seatTotal + ledPrice + colorPrice + deckColorPrice + railColorPrice;

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
  const seatPriceDisplay = document.getElementById('seatPriceDisplay');
  if (seatPriceDisplay) seatPriceDisplay.textContent = seatTotal > 0 ? '₱' + seatTotal.toLocaleString() + ' (' + seatCapacity + ' × ₱' + perSeatPrice.toLocaleString() + ')' : 'None';
  const ledPriceDisplay = document.getElementById('ledPriceDisplay');
  if (ledPriceDisplay) ledPriceDisplay.textContent = '₱' + ledPrice.toLocaleString();
  const colorPriceDisplay = document.getElementById('colorPriceDisplay');
  if (colorPriceDisplay) {
    const hullOptions = inventoryItems.colors.filter(c => c.metadata?.hex === hullColor);
    const hullOption = hullOptions.find(c => !c.metadata?.isDefault) || hullOptions[0];
    colorPriceDisplay.textContent = hullOption ? hullOption.name + (hullOption.price > 0 ? ' ₱' + hullOption.price.toLocaleString() : '') : 'Default';
  }

  const deckColorPriceDisplay = document.getElementById('deckColorPriceDisplay');
  if (deckColorPriceDisplay) {
    const deckOptions = inventoryItems.deckColors.filter(c => c.metadata?.hex === deckColor);
    const deckOption = deckOptions.find(c => !c.metadata?.isDefault) || deckOptions[0];
    deckColorPriceDisplay.textContent = deckOption ? deckOption.name + (deckOption.price > 0 ? ' ₱' + deckOption.price.toLocaleString() : '') : 'Default Deck';
  }
  const railColorPriceDisplay = document.getElementById('railColorPriceDisplay');
  if (railColorPriceDisplay) {
    const railOptions = inventoryItems.railColors.filter(c => c.metadata?.hex === railColor);
    const railOption = railOptions.find(c => !c.metadata?.isDefault) || railOptions[0];
    railColorPriceDisplay.textContent = railOption ? railOption.name + (railOption.price > 0 ? ' ₱' + railOption.price.toLocaleString() : '') : 'Default Rail';
  }

  recommendedSeats.textContent = maxCap + ' Seats';
  currentSeats.textContent = seats + ' Seats';

  const remaining = maxCap - seats;
  if (remaining >= 0) {
    remainingWeight.textContent = remaining + ' Seats';
    remainingWeight.className = 'green';
  } else {
    remainingWeight.textContent = Math.abs(remaining) + ' Over Capacity';
    remainingWeight.className = '';
    remainingWeight.style.color = '#dc2626';
  }

  const safeRatio = len / wid;
  let score = 92;
  if (safeRatio < 2.5 || safeRatio > 6) score = 55;
  else if (safeRatio < 3 || safeRatio > 5) score = 70;

  const safetyHeading = safetyBox.querySelector('h3');
  const safetyText = safetyBox.querySelector('p');
  const scoreCircle = safetyBox.querySelector('.score-circle');

  if (score >= 80) {
    safetyHeading.textContent = 'SAFE & BALANCED';
    safetyHeading.style.color = '#16a34a';
    safetyText.textContent = 'Great! Your configuration is within safe limits.';
    scoreCircle.style.borderColor = '#22c55e';
  } else if (score >= 60) {
    safetyHeading.textContent = 'CAUTION';
    safetyHeading.style.color = '#ca8a04';
    safetyText.textContent = 'Consider adjusting length/width ratio for better stability.';
    scoreCircle.style.borderColor = '#eab308';
  } else {
    safetyHeading.textContent = 'UNSTABLE';
    safetyHeading.style.color = '#dc2626';
    safetyText.textContent = 'Warning: Current configuration may be unsafe. Adjust dimensions.';
    scoreCircle.style.borderColor = '#ef4444';
  }
  scoreCircle.textContent = score + '%';
}

function darkenColor(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, r - amount);
  g = Math.max(0, g - amount);
  b = Math.max(0, b - amount);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

lengthRange.addEventListener('input', () => {
  lengthValue.textContent = parseFloat(lengthRange.value) + 'm';
  drawBoat();
});

widthRange.addEventListener('input', () => {
  widthValue.textContent = parseFloat(widthRange.value) + 'm';
  drawBoat();
});

engineHP.addEventListener('change', drawBoat);
seatSelect.addEventListener('change', drawBoat);
  ledSelect.addEventListener('change', drawBoat);
  
  


function is1950Boat() {
  try {
    const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
    const name = draft?.boatData?.name || '';
    if (/1950/i.test(name)) return true;
  } catch (e) { }
  const boatNameEl = document.getElementById('boatModelName');
  if (boatNameEl && /1950/i.test(boatNameEl.textContent)) return true;
  return false;
}

document.getElementById('rotateBtn')?.addEventListener('click', () => {
  if (is1950Boat() && currentView === 'perspective') {
    rotateThree();
    return;
  }
  rotationAngle += Math.PI / 8;
  drawBoat();
});

document.getElementById('zoomInBtn')?.addEventListener('click', () => {
  if (is1950Boat() && currentView === 'perspective') {
    zoomThree(1);
    return;
  }
  zoomLevel = Math.min(2, zoomLevel + 0.1);
  drawBoat();
});

document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
  if (is1950Boat() && currentView === 'perspective') {
    zoomThree(-1);
    return;
  }
  zoomLevel = Math.max(0.3, zoomLevel - 0.1);
  drawBoat();
});

document.getElementById('resetBtn')?.addEventListener('click', () => {
  if (is1950Boat() && currentView === 'perspective') {
    resetThree();
    return;
  }
  rotationAngle = 0;
  zoomLevel = 1;
  drawBoat();
});

document.querySelectorAll('.view-buttons button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-buttons button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const text = btn.textContent.trim().toLowerCase();
    if (text === 'exterior') currentView = 'exterior';
    else if (text === 'interior') currentView = 'interior';
    else if (text === 'top view') currentView = 'top';
    else if (text === 'rear view') currentView = 'rear';
    else if (text === 'front view') currentView = 'front';
    else if (text === '3d view' || text === 'perspective') currentView = 'perspective';
    if (is1950Boat()) {
      if (currentView === 'perspective') {
        showThreeView(true);
        const threeDiv = document.getElementById('threeViewer');
        const canvas = document.getElementById('boatCanvas');
        if (threeDiv) threeDiv.style.display = 'block';
        if (canvas) canvas.style.display = 'none';
      } else {
        showThreeView(false);
        drawBoat();
      }
    } else {
      showThreeView(false);
  drawBoat();
}
  });
});

document.querySelector('.reset-btn').addEventListener('click', () => {
  applyBoatSpecDefaults();
  applyDefaultEngineSelection();
  applyDefaultSeatSelection();
  ledSelect.value = '0';
  rotationAngle = 0;
  zoomLevel = 1;
  hullColor = '#111827';
  deckColor = '#8B7355';
  railColor = '#C0C0C0';
  colorPrice = 0;
  document.querySelectorAll('.colors.hull-colors .color').forEach(c => c.classList.remove('active'));
  const defaultHull = document.querySelector('.colors.hull-colors .color.default');
  if (defaultHull) defaultHull.classList.add('active');
  document.querySelectorAll('.colors.deck-colors .color').forEach(c => c.classList.remove('active'));
  const defaultDeck = document.querySelector('.colors.deck-colors .color');
  if (defaultDeck) defaultDeck.classList.add('active');
  document.querySelectorAll('.colors.rail-colors .color').forEach(c => c.classList.remove('active'));
  const defaultRail = document.querySelector('.colors.rail-colors .color');
  if (defaultRail) defaultRail.classList.add('active');
  drawBoat();
});

document.getElementById('saveQuoteBtn')?.addEventListener('click', () => {
  const seatOpt = seatSelect.selectedOptions[0];
  const seatCapacity = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatTotal = parseInt(seatSelect.value) || 0;
  const enginePrice = parseInt(engineHP.value);
  const ledPrice = parseInt(ledSelect.value);
  const originalPrice = getOriginalPrice();
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const qOpt = inventoryItems.deckColors.find(c => c.metadata?.hex === deckColor && !c.metadata?.isDefault) || inventoryItems.deckColors.find(c => c.metadata?.hex === deckColor);
  const sOpt = inventoryItems.railColors.find(c => c.metadata?.hex === railColor && !c.metadata?.isDefault) || inventoryItems.railColors.find(c => c.metadata?.hex === railColor);
  const qDp = qOpt?.price || 0;
  const qRp = sOpt?.price || 0;
  const total = basePrice + enginePrice + seatTotal + ledPrice + colorPrice + qDp + qRp;

  const engineBrandName = engineBrand.value || '';
  const engineHPText = engineHP.selectedOptions[0]?.textContent || '';
  const engineDisplayName = engineBrandName && engineHPText && engineHPText !== 'None' ? engineBrandName + ' ' + engineHPText : 'None';

  const qHullOpt = inventoryItems.colors.find(c => c.metadata?.hex === hullColor && !c.metadata?.isDefault) || inventoryItems.colors.find(c => c.metadata?.hex === hullColor);

  const items = [
    { name: 'Base Boat', amount: originalPrice }
  ];
  if (extensionCost > 0) {
    items.push({ name: 'Dimension Extension', amount: extensionCost });
  }
  items.push(
    { name: 'Engine: ' + engineDisplayName, amount: enginePrice },
    { name: 'Seats (' + seatCapacity + ' × ₱' + Math.round(seatTotal / seatCapacity).toLocaleString() + ')', amount: seatTotal },
    { name: 'LED: ' + (ledSelect.selectedOptions[0]?.dataset?.name || ''), amount: ledPrice }
  );
  if (colorPrice > 0) {
    items.push({ name: 'Hull Paint: ' + (qHullOpt?.name || 'Custom'), amount: colorPrice });
  }
  if (qDp > 0) {
    items.push({ name: 'Deck Color: ' + (qOpt?.name || 'Custom'), amount: qDp });
  }
  if (qRp > 0) {
    items.push({ name: 'Rail Color: ' + (sOpt?.name || 'Custom'), amount: qRp });
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
    seats: String(seatCapacity),
    seatsItem: seatSelect.selectedOptions[0]?.dataset?.id || '',
    seatsName: seatSelect.selectedOptions[0]?.dataset?.name || '',
    seatTotal: String(seatTotal),
    perSeatPrice: String(Math.round(seatTotal / seatCapacity)),
    led: ledPrice,
    ledItem: ledSelect.selectedOptions[0]?.dataset?.id || '',
    ledName: ledSelect.selectedOptions[0]?.dataset?.name || '',
    color: hullColor,
    colorPrice: String(colorPrice),
    hullColorName: qHullOpt?.name || 'Default',
    deckColor: deckColor,
    deckColorPrice: String(qDp),
    deckColorName: qOpt?.name || 'Default Deck',
    railColor: railColor,
    railColorPrice: String(qRp),
    railColorName: sOpt?.name || 'Default Rail',
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

(function checkAccessControl() {
  if (revisionOrderId) return;
  let draft;
  try { draft = JSON.parse(localStorage.getItem('customBuildDraft')); } catch (e) { draft = null; }
  if (!draft || !draft.boatData || !draft.boatData.name) {
    const submitBtns = document.querySelectorAll('.submit-review-btn, .quote-btn, #custPaymentSection');
    submitBtns.forEach(el => { if (el) el.style.display = 'none'; });

    const previewBanner = document.createElement('div');
    previewBanner.style.cssText = 'padding:16px;background:#2563eb;color:white;border-radius:12px;margin:16px;text-align:center;font-size:14px;';
    previewBanner.innerHTML = '<i class="fa-solid fa-eye"></i> Preview Mode — <a href="order.html" style="color:#fff;font-weight:700;">Place an order</a> to customize this boat.';
    document.querySelector('.left-sidebar').appendChild(previewBanner);

    const modelEl = document.getElementById('boatModelName');
    if (modelEl) modelEl.textContent = 'Boat Preview';
  } else {
    const savedMethod = draft.paymentMethod;
    if (savedMethod) {
      const radios = document.querySelectorAll('input[name="custPaymentMethod"]');
      radios.forEach(r => {
        r.disabled = true;
        if (r.value === savedMethod) r.checked = true;
      });
      const labels = document.querySelectorAll('#custFullPayLabel, #custInstallLabel');
      labels.forEach(l => { if (l) l.style.cursor = 'default'; });
    }
  }
})();



function updateLengthDisplay() {
  lengthValue.textContent = parseFloat(lengthRange.value) + 'm';
}
function updateWidthDisplay() {
  widthValue.textContent = parseFloat(widthRange.value) + 'm';
}
function updateColorPreview() {
  document.querySelectorAll('.colors.hull-colors .color').forEach(c => c.classList.remove('active'));
  const hullMatch = document.querySelector(`.colors.hull-colors .color[data-color="${hullColor}"]`);
  if (hullMatch) hullMatch.classList.add('active');

  document.querySelectorAll('.colors.deck-colors .color').forEach(c => c.classList.remove('active'));
  const deckMatch = document.querySelector(`.colors.deck-colors .color[data-color="${deckColor}"]`);
  if (deckMatch) deckMatch.classList.add('active');

  document.querySelectorAll('.colors.rail-colors .color').forEach(c => c.classList.remove('active'));
  const railMatch = document.querySelector(`.colors.rail-colors .color[data-color="${railColor}"]`);
  if (railMatch) railMatch.classList.add('active');
}
function renderCanvas() {
  drawBoat();
}

async function loadRevisionOrder(orderId) {
  const { data } = await handleDbError(
    supabase.from("boat_orders").select("*").eq("orderId", orderId).single(),
    "Load revision order"
  );
  if (!data || !data.customConfig) return;
  const cfg = data.customConfig;
  const draft = {
    boatData: { name: data.boatName?.replace(" (Custom)", ""), image: data.boatImage, price: cfg.originalPrice || data.boatPrice },
    buildType: "custom",
    contractSchedule: data.contractSchedule,
    guidelineResponses: data.guidelineResponses || {},
    comments: data.guidelineComments || {}
  };
  localStorage.setItem("customBuildDraft", JSON.stringify(draft));
  localStorage.setItem("boatConfig", JSON.stringify(cfg));

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
  if (cfg.seatsItem) {
    const sOpt = seatSelect.querySelector(`option[data-id="${cfg.seatsItem}"]`);
    if (sOpt) seatSelect.value = sOpt.value;
  }
  if (cfg.ledItem) {
    const lOpt = ledSelect.querySelector(`option[data-id="${cfg.ledItem}"]`);
    if (lOpt) ledSelect.value = lOpt.value;
  }
  hullColor = cfg.color || "#111827";
  deckColor = cfg.deckColor || "#8B7355";
  railColor = cfg.railColor || "#C0C0C0";
  colorPrice = parseInt(cfg.colorPrice) || 0;
  updateColorPreview();
  renderCanvas();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForOptionsReady(maxMs = 3000) {
  const step = 100;
  for (let waited = 0; waited < maxMs; waited += step) {
    if (inventoryItems.engines.length || inventoryItems.seats.length) return;
    await delay(step);
  }
}

document.getElementById('submitReviewBtn').addEventListener('click', async () => {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const isRevision = !!revisionOrderId;
  if (!draft || !draft.boatData) {
    if (!isRevision) {
      alert('No custom build session found. Please start from the order page.');
      window.location.href = 'home.html';
      return;
    }
  }

  const originalPrice = getOriginalPrice();
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const seatOpt = seatSelect.selectedOptions[0];
  const seatCapacity = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatTotal = parseInt(seatSelect.value) || 0;
  const enginePrice = parseInt(engineHP.value);
  const ledPrice = parseInt(ledSelect.value);
  const dOpt = inventoryItems.deckColors.find(c => c.metadata?.hex === deckColor && !c.metadata?.isDefault) || inventoryItems.deckColors.find(c => c.metadata?.hex === deckColor);
  const rOpt = inventoryItems.railColors.find(c => c.metadata?.hex === railColor && !c.metadata?.isDefault) || inventoryItems.railColors.find(c => c.metadata?.hex === railColor);
  const dp = dOpt?.price || 0;
  const rp = rOpt?.price || 0;
  const total = basePrice + enginePrice + seatTotal + ledPrice + colorPrice + dp + rp;

  const engineBrandName = engineBrand.value || '';
  const engineHPText = engineHP.selectedOptions[0]?.textContent || '';
  const engineDisplayName = engineBrandName && engineHPText && engineHPText !== 'None' ? engineBrandName + ' ' + engineHPText : 'None';

  const hullOpt = inventoryItems.colors.find(c => c.metadata?.hex === hullColor && !c.metadata?.isDefault) || inventoryItems.colors.find(c => c.metadata?.hex === hullColor);

  const items = [
    { name: 'Base Boat', amount: originalPrice }
  ];
  if (extensionCost > 0) {
    items.push({ name: 'Dimension Extension', amount: extensionCost });
  }
  items.push(
    { name: 'Engine: ' + engineDisplayName, amount: enginePrice },
    { name: 'Seats (' + seatCapacity + ' × ₱' + Math.round(seatTotal / seatCapacity).toLocaleString() + ')', amount: seatTotal },
    { name: 'LED: ' + (ledSelect.selectedOptions[0]?.dataset?.name || ''), amount: ledPrice }
  );
  if (colorPrice > 0) {
    items.push({ name: 'Hull Paint: ' + (hullOpt?.name || 'Custom'), amount: colorPrice });
  }
  if (dp > 0) {
    items.push({ name: 'Deck Color: ' + (dOpt?.name || 'Custom'), amount: dp });
  }
  if (rp > 0) {
    items.push({ name: 'Rail Color: ' + (rOpt?.name || 'Custom'), amount: rp });
  }

  const savedView = currentView;
  const savedRotation = rotationAngle;
  const savedZoom = zoomLevel;
  currentView = 'exterior';
  rotationAngle = 0;
  zoomLevel = 1;
  drawBoat();
  let boatPreviewImage = '';
  try { boatPreviewImage = canvas.toDataURL('image/png'); } catch (e) { boatPreviewImage = ''; }
  currentView = savedView;
  rotationAngle = savedRotation;
  zoomLevel = savedZoom;
  drawBoat();

  const config = {
    length: lengthRange.value,
    width: widthRange.value,
    engineBrand: engineBrandName,
    engine: String(enginePrice),
    engineItem: engineHP.selectedOptions[0]?.dataset?.id || '',
    engineName: engineDisplayName,
    seats: String(seatCapacity),
    seatsItem: seatSelect.selectedOptions[0]?.dataset?.id || '',
    seatsName: seatSelect.selectedOptions[0]?.dataset?.name || '',
    seatTotal: String(seatTotal),
    perSeatPrice: String(Math.round(seatTotal / seatCapacity)),
    led: String(ledPrice),
    ledItem: ledSelect.selectedOptions[0]?.dataset?.id || '',
    ledName: ledSelect.selectedOptions[0]?.dataset?.name || '',
    color: hullColor,
    colorPrice: String(colorPrice),
    hullColorName: hullOpt?.name || 'Default',
    deckColor: deckColor,
    deckColorPrice: String(dp),
    deckColorName: dOpt?.name || 'Default Deck',
    railColor: railColor,
    railColorPrice: String(rp),
    railColorName: rOpt?.name || 'Default Rail',
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
  const custPayMethod = document.querySelector('input[name="custPaymentMethod"]:checked')?.value || "Full Payment";

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
    sendEmailNotification({ type: "status_changed", recipient: "infinityboatsystem@gmail.com", data: { orderId: revisionOrderId, customerName, customerEmail, status: "Under Review", orderPhase: "Revision Submitted", progress: 0 } });
    localStorage.removeItem('customBuildDraft');
    localStorage.removeItem('boatConfig');
    alert('Your revised design has been submitted for review.');
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
  sendEmailNotification({ type: "order_created", recipient: "infinityboatsystem@gmail.com", data: order });

  localStorage.removeItem('customBuildDraft');
  localStorage.removeItem('boatConfig');

  alert('Custom design submitted for engineering review! You will be notified once it has been evaluated.');
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

window.addEventListener('resize', resizeCanvas);
loadBoatModelInfo();

ctx.__proto__.roundRect = function (x, y, w, h, r) {
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  this.moveTo(x + r, y);
  this.lineTo(x + w - r, y);
  this.quadraticCurveTo(x + w, y, x + w, y + r);
  this.lineTo(x + w, y + h - r);
  this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  this.lineTo(x + r, y + h);
  this.quadraticCurveTo(x, y + h, x, y + h - r);
  this.lineTo(x, y + r);
  this.quadraticCurveTo(x, y, x + r, y);
  return this;
};

applyBoatSpecDefaults();
loadOptions().then(() => resizeCanvas()).catch(err => {
  console.error('loadOptions failed:', err);
  resizeCanvas();
});
