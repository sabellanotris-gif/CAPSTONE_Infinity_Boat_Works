import { supabase, handleDbError } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "index.html";
};

// Session & role guard
(async () => {
  const auth = await window.requireRole(["admin", "manager"]);
  if (!auth) return;
  window.currentRole = auth.profile.role;
})();

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

/* ============================================
   ANALYTICS REPORT GENERATION (formal PDF)
   NOTE: jsPDF's built-in fonts do not support
   the ₱ (U+20B1) character — it renders as "±".
   All currency below uses ASCII "PHP" instead.
   ============================================ */

function parsePrice(value) {
  return parseInt(String(value || '').replace(/[^0-9]/g, ''), 10) || 0;
}

function fmtPeso(value) {
  return Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) {
    return String(dateStr);
  }
}

function fitText(str, maxChars) {
  const s = String(str || '');
  return s.length > maxChars ? s.substring(0, Math.max(1, maxChars - 1)) + '...' : s;
}

document.querySelector('.report-btn')?.addEventListener('click', async () => {
  const result = await handleDbError(
    supabase.from("boat_orders").select("*"),
    "Generate report"
  );
  const orders = (result && !result.error ? result.data : []) || [];

  if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    const totalValue = orders.reduce((s, o) => s + parsePrice(o.boatPrice), 0);
    const lines = [
      'INFINITY BOAT WORKS',
      'Business Analytics Report',
      'Generated: ' + new Date().toLocaleString(),
      '',
      'SUMMARY',
      'Total Orders: ' + orders.length,
      'Completed Orders: ' + orders.filter(o => o.status === 'Completed').length,
      'Pending Orders: ' + orders.filter(o => o.status === 'Pending' || o.status === 'Pending Signing').length,
      'Total Revenue: PHP ' + fmtPeso(totalValue),
      '',
      'ORDER DETAILS',
      'Customer | Boat Model | Price (PHP) | Status | Date',
      ...orders.map(o => [
        fitText(o.customerName || 'Unknown', 20),
        fitText(o.boatName || 'Boat', 24),
        fmtPeso(parsePrice(o.boatPrice)),
        o.status || 'Pending',
        fmtDate(o.createdAt)
      ].join(' | '))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
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
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  const totalValue = orders.reduce((s, o) => s + parsePrice(o.boatPrice), 0);
  const completedCount = orders.filter(o => o.status === 'Completed').length;
  const pendingCount = orders.filter(o => o.status === 'Pending' || o.status === 'Pending Signing').length;

  const boatAgg = {};
  orders.forEach(o => {
    const name = o.boatName || 'Unknown';
    if (!boatAgg[name]) boatAgg[name] = { count: 0, revenue: 0 };
    boatAgg[name].count += 1;
    boatAgg[name].revenue += parsePrice(o.boatPrice);
  });
  const sortedBoats = Object.entries(boatAgg).sort(
    (a, b) => b[1].count - a[1].count || b[1].revenue - a[1].revenue
  );

  let y = 0;

  function drawHeaderBlock() {
    y = 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(30, 58, 95);
    doc.text('INFINITY BOAT WORKS', pageWidth / 2, y, { align: 'center' });
    y += 7;
    doc.setFontSize(12);
    doc.setTextColor(60, 60, 60);
    doc.text('Business Analytics Report', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(
      'Report Period: All Orders   |   Generated: ' + new Date().toLocaleString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
      pageWidth / 2, y, { align: 'center' }
    );
    y += 4;
    doc.setDrawColor(30, 58, 95);
    doc.setLineWidth(0.6);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 10;
  }

  function ensureSpace(needed) {
    if (y + needed > pageHeight - 16) {
      doc.addPage();
      y = 18;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text('Infinity Boat Works - Business Analytics Report', marginX, y);
      y += 8;
      return true;
    }
    return false;
  }

  function sectionTitle(text) {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 58, 95);
    doc.text(text, marginX, y);
    y += 3;
    doc.setDrawColor(200, 204, 210);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;
  }

  function drawSummaryRows(rows) {
    rows.forEach(([label, value]) => {
      ensureSpace(7);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(50, 50, 50);
      doc.text(label, marginX + 2, y);
      doc.setFont('helvetica', 'bold');
      doc.text(value, pageWidth - marginX - 2, y, { align: 'right' });
      y += 7;
    });
  }

  function drawTableHeader(columns) {
    doc.setFillColor(30, 58, 95);
    doc.rect(marginX, y - 5, contentWidth, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    columns.forEach(c => doc.text(c.header, c.x, y - 1.5, { align: c.align || 'left' }));
    doc.setFont('helvetica', 'normal');
    y += 6;
  }

  function drawTableRows(columns, rows) {
    drawTableHeader(columns);
    let alt = false;
    rows.forEach(r => {
      if (ensureSpace(6)) {
        drawTableHeader(columns);
        alt = false;
      }
      if (alt) {
        doc.setFillColor(244, 246, 248);
        doc.rect(marginX, y - 5, contentWidth, 6, 'F');
      }
      alt = !alt;
      doc.setTextColor(40, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      columns.forEach(c => {
        doc.text(r[c.key] || '', c.x, y, { align: c.align || 'left' });
      });
      doc.setDrawColor(222, 225, 230);
      doc.setLineWidth(0.2);
      doc.line(marginX, y + 1.5, pageWidth - marginX, y + 1.5);
      y += 6;
    });
    y += 6;
  }

  drawHeaderBlock();

  sectionTitle('EXECUTIVE SUMMARY');
  drawSummaryRows([
    ['Total Orders', String(orders.length)],
    ['Completed Orders', String(completedCount)],
    ['Pending Orders', String(pendingCount)],
    ['Total Revenue', 'PHP ' + fmtPeso(totalValue)],
  ]);
  y += 4;

  sectionTitle('TOP BOAT MODELS');
  drawTableRows(
    [
      { key: 'rank', header: 'Rank', x: 20, align: 'center' },
      { key: 'name', header: 'Boat Model', x: 40 },
      { key: 'orders', header: 'Orders', x: 142, align: 'right' },
      { key: 'revenue', header: 'Revenue (PHP)', x: 196, align: 'right' },
    ],
    sortedBoats.map(([name, agg], i) => ({
      rank: String(i + 1),
      name: fitText(name, 34),
      orders: String(agg.count),
      revenue: fmtPeso(agg.revenue),
    }))
  );

  sectionTitle('ORDER DETAILS');
  drawTableRows(
    [
      { key: 'customer', header: 'Customer', x: 14 },
      { key: 'boat', header: 'Boat Model', x: 54 },
      { key: 'status', header: 'Status', x: 104 },
      { key: 'price', header: 'Price (PHP)', x: 158, align: 'right' },
      { key: 'date', header: 'Date', x: 196, align: 'right' },
    ],
    orders.map(o => ({
      customer: fitText(o.customerName || 'Unknown', 18),
      boat: fitText(o.boatName || 'Boat', 24),
      status: fitText(o.status || 'Pending', 14),
      price: fmtPeso(parsePrice(o.boatPrice)),
      date: fmtDate(o.createdAt),
    }))
  );

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text('Infinity Boat Works  |  Page ' + i + ' of ' + pageCount, pageWidth / 2, pageHeight - 8, { align: 'center' });
  }

  doc.save('analytics_report_' + new Date().toISOString().slice(0, 10) + '.pdf');
});
