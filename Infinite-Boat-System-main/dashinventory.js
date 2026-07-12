import { supabase, handleDbError } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

const DEFAULT_ITEMS = [
  { name: 'Marine Engine', category: 'Equipment', stock: 24, price: 450000 },
  { name: 'Fiberglass Sheet', category: 'Material', stock: 8, price: 12000 },
  { name: 'Boat Seats', category: 'Interior', stock: 56, price: 8500 },
  { name: 'Marine Paint', category: 'Material', stock: 3, price: 4500 },
  { name: 'Engine Parts', category: 'Equipment', stock: 2, price: 25000 },
  { name: 'Fiberglass Resin', category: 'Material', stock: 1, price: 3800 },
  { name: 'Stainless Steel Rails', category: 'Hardware', stock: 18, price: 15000 },
  { name: 'Navigation Lights', category: 'Equipment', stock: 32, price: 3200 },
  { name: 'Anchor Chain', category: 'Hardware', stock: 12, price: 8500 },
  { name: 'Life Jackets', category: 'Safety', stock: 45, price: 1200 },
  { name: 'Propeller', category: 'Equipment', stock: 9, price: 18000 },
  { name: 'Electrical Wiring', category: 'Material', stock: 15, price: 2500 },
  { name: 'Deck Hatches', category: 'Hardware', stock: 22, price: 7500 },
  { name: 'Porthole Windows', category: 'Hardware', stock: 28, price: 4200 },
  // 3D Customization parts (used by boatcust.js)
  { name: 'Suzuki 150 HP', category: 'Engine', stock: 5, price: 700000, metadata: { brand: 'Suzuki', hp: 150, optionType: 'engine' } },
  { name: 'Suzuki 250 HP', category: 'Engine', stock: 5, price: 1346000, metadata: { brand: 'Suzuki', hp: 250, optionType: 'engine' } },
  { name: 'Suzuki 300 HP', category: 'Engine', stock: 5, price: 1469000, metadata: { brand: 'Suzuki', hp: 300, optionType: 'engine' } },
  { name: 'Mercury 150 HP', category: 'Engine', stock: 5, price: 850000, metadata: { brand: 'Mercury', hp: 150, optionType: 'engine' } },
  { name: 'Mercury 250 HP', category: 'Engine', stock: 5, price: 1400000, metadata: { brand: 'Mercury', hp: 250, optionType: 'engine' } },
  { name: 'Mercury 300 HP', category: 'Engine', stock: 5, price: 1700000, metadata: { brand: 'Mercury', hp: 300, optionType: 'engine' } },
  { name: '8 Seats', category: 'Seats', stock: 99, price: 52000, metadata: { capacity: 8, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '12 Seats', category: 'Seats', stock: 99, price: 78000, metadata: { capacity: 12, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '15 Seats', category: 'Seats', stock: 99, price: 97500, metadata: { capacity: 15, optionType: 'seats', perSeatPrice: 6500 } },
  { name: 'Blue LED', category: 'LED', stock: 20, price: 25000, metadata: { ledType: 'blue', optionType: 'led' } },
  { name: 'RGB LED', category: 'LED', stock: 15, price: 45000, metadata: { ledType: 'rgb', optionType: 'led' } },
  { name: 'White Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#ffffff', optionType: 'color' } },
  { name: 'Blue Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#2563eb', optionType: 'color' } },
  { name: 'Dark Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#111827', optionType: 'color' } },
  { name: 'Red Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#dc2626', optionType: 'color' } },
  { name: 'Green Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#65a30d', optionType: 'color' } }
];

let totalMaterialsEl, lowStockEl, equipmentEl, inventoryValueEl;

async function getInventory() {
  const result = await handleDbError(
    supabase.from("inventory").select("*").order("createdAt", { ascending: false }),
    "Load inventory"
  );
  if (result && !result.error && result.data && result.data.length > 0) return result.data;
  // Seed defaults
  for (const item of DEFAULT_ITEMS) {
    await supabase.from("inventory").insert(item);
  }
  const { data: seeded } = await supabase.from("inventory").select("*");
  return seeded || [];
}

async function saveInventory(items) {
  const { error } = await supabase.from("inventory").upsert(
    items.map(i => ({
      id: i.id || undefined,
      name: i.name,
      category: i.category,
      stock: i.stock,
      price: i.price,
      metadata: i.metadata || null
    })),
    { onConflict: "id" }
  );
  if (error) showToast("Failed to save inventory: " + error.message, "error");
}

async function renderInventory() {
  const items = await getInventory();
  const tbody = document.getElementById('inventoryTable');
  if (!tbody) return;

  totalMaterialsEl = document.querySelector('.stat-card:nth-child(1) h2');
  lowStockEl = document.querySelector('.stat-card:nth-child(2) h2');
  equipmentEl = document.querySelector('.stat-card:nth-child(3) h2');
  inventoryValueEl = document.querySelector('.stat-card:nth-child(4) h2');

  const lowStock = items.filter(i => (i.stock || 0) <= 5);
  const equip = items.filter(i => i.category === 'Equipment');
  const totalValue = items.reduce((s, i) => s + (i.stock || 0) * i.price, 0);

  if (totalMaterialsEl) totalMaterialsEl.textContent = items.length;
  if (lowStockEl) lowStockEl.textContent = lowStock.length;
  if (equipmentEl) equipmentEl.textContent = equip.length;
  if (inventoryValueEl) inventoryValueEl.textContent = '₱' + (totalValue / 1000000).toFixed(1) + 'M';

  const CUSTOMIZATION_CATEGORIES = ['Engine', 'Seats', 'LED', 'Color'];
  tbody.innerHTML = items.map((item, idx) => {
    const stock = item.stock || 0;
    const status = stock <= 5 ? 'Low Stock' : 'Available';
    const statusClass = stock <= 5 ? 'low-stock' : 'available';
    const isCustom = CUSTOMIZATION_CATEGORIES.includes(item.category);
    return `<tr>
      <td>${item.name}${isCustom ? ' <span style="font-size:10px;padding:1px 6px;border-radius:50px;background:#dbeafe;color:#2563eb;font-weight:500;">3D</span>' : ''}</td>
      <td>${item.category}</td>
      <td>${stock}</td>
      <td><span class="${statusClass}">${status}</span></td>
      <td>₱${(item.price || 0).toLocaleString()}</td>
      <td>
        <button class="view-btn edit-btn" data-idx="${idx}">Edit</button>
        <button class="view-btn delete-btn" style="background:#dc2626;margin-left:5px" data-idx="${idx}">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

renderInventory();

document.querySelector('.add-btn')?.addEventListener('click', async () => {
  const name = prompt('Item name:');
  if (!name) return;
  const category = prompt('Category:');
  if (!category) return;
  const stock = parseInt(prompt('Stock count:'));
  if (isNaN(stock)) return;
  const price = parseInt(prompt('Price (₱):'));
  if (isNaN(price)) return;
  const items = await getInventory();
  let metadata = null;
  if (['Engine', 'Seats', 'LED', 'Color'].includes(category)) {
    try {
      const metaStr = prompt('Metadata JSON (e.g. {"hp":300}):', '{}');
      if (metaStr) metadata = JSON.parse(metaStr);
    } catch { showToast('Invalid JSON, saved without metadata', 'warning'); }
  }
  items.push({ name, category, stock, price, metadata });
  await saveInventory(items);
  await renderInventory();
});

document.querySelector('#inventoryTable')?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const deleteBtn = e.target.closest('.delete-btn');
  if (!editBtn && !deleteBtn) return;

  const idx = parseInt((editBtn || deleteBtn).dataset.idx);
  const items = await getInventory();

  if (deleteBtn) {
    if (!confirm('Delete this item?')) return;
    const item = items[idx];
    if (item && item.id) {
      await handleDbError(
        supabase.from("inventory").delete().eq("id", item.id),
        "Delete inventory item"
      );
    }
    await renderInventory();
    return;
  }

  if (editBtn) {
    const item = items[idx];
    const name = prompt('Item name:', item.name);
    if (!name) return;
    const category = prompt('Category:', item.category);
    if (!category) return;
    const stock = parseInt(prompt('Stock count:', item.stock));
    if (isNaN(stock)) return;
    const price = parseInt(prompt('Price (₱):', item.price));
    if (isNaN(price)) return;
    let metadata = item.metadata;
    if (metadata && Object.keys(metadata).length > 0) {
      try {
        const metaStr = prompt('Metadata (JSON):', JSON.stringify(metadata));
        if (metaStr) metadata = JSON.parse(metaStr);
      } catch { showToast('Invalid JSON, metadata preserved', 'warning'); }
    }
    items[idx] = { ...item, name, category, stock, price, metadata };
    await saveInventory(items);
    await renderInventory();
  }
});

document.getElementById('searchInput')?.addEventListener('input', function () {
  const q = this.value.toLowerCase();
  document.querySelectorAll('#inventoryTable tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});
