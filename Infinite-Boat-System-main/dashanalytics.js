import { supabase, handleDbError } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

async function loadAnalytics() {
  const result = await handleDbError(
    supabase.from("boat_orders").select("*"),
    "Load analytics"
  );
  const orders = (result && !result.error ? result.data : []) || [];

  const visitorsEl = document.querySelector('.stat-card:nth-child(1) h2');
  const ordersEl = document.querySelector('.stat-card:nth-child(2) h2');
  const conversionEl = document.querySelector('.stat-card:nth-child(3) h2');
  const revenueGrowthEl = document.querySelector('.stat-card:nth-child(4) h2');

  const totalValue = orders.reduce((s, o) => s + (parseInt(String(o.boatPrice || '0').replace(/[^0-9]/g, '')) || 0), 0);
  const thisMonth = orders.filter(o => o.createdAt && new Date(o.createdAt).getMonth() === new Date().getMonth() && new Date(o.createdAt).getFullYear() === new Date().getFullYear());

  if (visitorsEl) visitorsEl.textContent = thisMonth.length;
  if (ordersEl) ordersEl.textContent = orders.length;
  if (conversionEl) conversionEl.textContent = orders.length > 0 ? Math.round((orders.filter(o => o.status === 'Completed').length / orders.length) * 100) + '%' : '0%';
  if (revenueGrowthEl) revenueGrowthEl.textContent = '₱' + (totalValue / 1000000).toFixed(1) + 'M';

  const boatCount = {};
  orders.forEach(o => {
    const name = o.boatName || 'Unknown';
    boatCount[name] = (boatCount[name] || 0) + 1;
  });

  const sorted = Object.entries(boatCount).sort((a, b) => b[1] - a[1]);
  const topBoatsList = document.getElementById('topBoatsList');
  if (topBoatsList) {
    topBoatsList.innerHTML = sorted.slice(0, 3).map(([name, count], i) =>
      `<div class="boat-item">
        <img src="./images/boat${(i % 4) + 1}.jpg" alt="${name}">
        <div><h4>${name}</h4><p>${count} Orders</p></div>
        <span>#${i + 1}</span>
      </div>`
    ).join('');
  }

  // Business Performance — derived from real order data
  const total = orders.length;
  const completed = orders.filter(o => o.status === 'Completed').length;
  const approved = orders.filter(o => o.status === 'Approved' || o.status === 'Completed').length;
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const satisfactionPct = total > 0 ? Math.round(((completed + 1) / (total + 2)) * 100) : 0;
  const deliveryPct = approved > 0 ? Math.round((completed / approved) * 100) : 0;

  const satFill = document.getElementById('satisfactionFill');
  const satPctEl = document.getElementById('satisfactionPct');
  if (satFill) satFill.style.width = satisfactionPct + '%';
  if (satPctEl) satPctEl.textContent = satisfactionPct + '%';

  const compFill = document.getElementById('completionFill');
  const compPctEl = document.getElementById('completionPct');
  if (compFill) compFill.style.width = completionPct + '%';
  if (compPctEl) compPctEl.textContent = completionPct + '%';

  const delFill = document.getElementById('deliveryFill');
  const delPctEl = document.getElementById('deliveryPct');
  if (delFill) delFill.style.width = deliveryPct + '%';
  if (delPctEl) delPctEl.textContent = deliveryPct + '%';

  // Website Traffic chart — monthly orders for last 6 months
  const chartEl = document.getElementById('trafficChart');
  if (chartEl) {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), year: d.getFullYear(), month: d.getMonth(), count: 0 });
    }
    orders.forEach(o => {
      if (!o.createdAt) return;
      const d = new Date(o.createdAt);
      const m = months.find(m => m.month === d.getMonth() && m.year === d.getFullYear());
      if (m) m.count++;
    });
    const maxCount = Math.max(1, ...months.map(m => m.count));
    chartEl.innerHTML = months.map(m => {
      const pct = Math.max(2, (m.count / maxCount) * 100);
      return `<div class="traffic-bar-group">
        <span class="traffic-bar-value">${m.count}</span>
        <div class="traffic-bar" style="height:${pct}%"></div>
        <span class="traffic-bar-label">${m.label}</span>
      </div>`;
    }).join('');
  }
}

loadAnalytics();

document.querySelector('.report-btn')?.addEventListener('click', async () => {
  const result = await handleDbError(
    supabase.from("boat_orders").select("*"),
    "Generate report"
  );
  const orders = (result && !result.error ? result.data : []) || [];

  if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    const report = orders.map(o =>
      (o.customerName || 'Unknown') + ' - ' +
      (o.boatName || 'Boat') + ' - ' +
      (o.status || 'Pending') + ' - ' +
      (o.boatPrice || '₱0')
    ).join('\n');
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analytics_report_' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.text('Analytics Report', pageWidth / 2, 20, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Generated: ' + new Date().toLocaleString(), pageWidth / 2, 28, { align: 'center' });

  const totalValue = orders.reduce((s, o) => s + (parseInt(String(o.boatPrice || '0').replace(/[^0-9]/g, '')) || 0), 0);

  doc.setFontSize(12);
  doc.text('Summary', 14, 40);
  doc.setFontSize(10);
  doc.text('Total Orders: ' + orders.length, 14, 48);
  doc.text('Total Revenue: ₱' + (totalValue / 1000000).toFixed(1) + 'M', 14, 55);
  doc.text('Completed: ' + orders.filter(o => o.status === 'Completed').length, 14, 62);
  doc.text('Pending: ' + orders.filter(o => o.status === 'Pending' || o.status === 'Pending Signing').length, 14, 69);

  const boatCount = {};
  orders.forEach(o => {
    const name = o.boatName || 'Unknown';
    boatCount[name] = (boatCount[name] || 0) + 1;
  });
  const sorted = Object.entries(boatCount).sort((a, b) => b[1] - a[1]);

  doc.setFontSize(12);
  doc.text('Top Boats', 14, 82);
  doc.setFontSize(10);
  sorted.slice(0, 5).forEach(([name, count], i) => {
    doc.text((i + 1) + '. ' + name + ' - ' + count + ' orders', 14, 90 + i * 7);
  });

  let y = 90 + sorted.slice(0, 5).length * 7 + 10;
  doc.setFontSize(12);
  doc.text('Order Details', 14, y);
  y += 8;

  doc.setFontSize(8);
  doc.text('Customer', 14, y);
  doc.text('Boat', 60, y);
  doc.text('Price', 110, y);
  doc.text('Status', 145, y);
  doc.text('Date', 175, y);
  y += 4;
  doc.line(14, y, 200, y);
  y += 4;

  doc.setFontSize(7);
  orders.forEach(o => {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    const price = o.boatPrice || '₱0';
    const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'N/A';
    doc.text((o.customerName || 'Unknown').substring(0, 18), 14, y);
    doc.text((o.boatName || 'Boat').substring(0, 18), 60, y);
    doc.text(String(price).substring(0, 14), 110, y);
    doc.text((o.status || 'Pending').substring(0, 12), 145, y);
    doc.text(date, 175, y);
    y += 5;
  });

  doc.save('analytics_report_' + new Date().toISOString().slice(0, 10) + '.pdf');
});
