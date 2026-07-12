import { supabase } from "./supabase.js";
import { handleDbError } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

function cleanPrice(val) {
    return parseFloat(String(val || '0').replace(/[₱,$\s]/g, '')) || 0;
}

async function fetchLiveData() {
    let orders = [], payments = [];

    const ordersRes = await handleDbError(
        supabase.from("boat_orders").select("*").order("createdAt", { ascending: false }),
        "Load orders"
    );
    if (ordersRes && !ordersRes.error) orders = ordersRes.data || [];

    const payRes = await handleDbError(
        supabase.from("dashboard_payments").select("*").order("createdAt", { ascending: false }),
        "Load payments"
    );
    if (payRes && !payRes.error) payments = payRes.data || [];

    if (orders.length === 0) {
        orders = JSON.parse(localStorage.getItem('boatOrders') || '[]');
    }
    if (payments.length === 0) {
        payments = JSON.parse(localStorage.getItem('dashboardPayments') || '[]');
    }

    return { orders, payments };
}

async function loadSalesData() {
  const { orders, payments } = await fetchLiveData();

  const totalRevenue = orders.reduce((s, o) => s + cleanPrice(o.boatPrice || o.price), 0);
  const paidOrders = orders.filter(o => o.status === 'Completed' || o.status === 'Approved');
  const pendingOrders = orders.filter(o => o.status === 'Pending');

  const totalExpenses = orders.reduce((s, o) => {
    const bi = o.budgetInfo;
    if (!bi || !bi.expenses) return s;
    return s + bi.expenses.reduce((es, e) => es + (parseFloat(e.amount) || 0), 0);
  }, 0);

  const actualProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? (actualProfit / totalRevenue) * 100 : 0;

  const revenueEl = document.getElementById('totalRevenue');
  const boatsSoldEl = document.getElementById('boatsSold');
  const pendingEl = document.getElementById('pendingPayments');
  const profitEl = document.getElementById('netProfit');
  const profitGrowth = document.getElementById('profitGrowth');

  if (revenueEl) revenueEl.textContent = '₱' + (totalRevenue / 1000000).toFixed(1) + 'M';
  if (boatsSoldEl) boatsSoldEl.textContent = paidOrders.length;
  if (pendingEl) pendingEl.textContent = '₱' + (pendingOrders.reduce((s, o) => s + cleanPrice(o.boatPrice || o.price), 0) / 1000000).toFixed(1) + 'M';
  if (profitEl) {
    const isProfitable = actualProfit >= 0;
    profitEl.textContent = (isProfitable ? '' : '-') + '₱' + Math.abs(actualProfit).toLocaleString();
    profitEl.style.color = isProfitable ? '#16a34a' : '#dc2626';
  }
  if (profitGrowth) {
    profitGrowth.textContent = totalExpenses > 0
      ? profitMargin.toFixed(1) + '% margin  •  ₱' + totalExpenses.toLocaleString() + ' expenses'
      : 'No expense data recorded yet';
    profitGrowth.style.color = profitMargin >= 20 ? '#16a34a' : profitMargin > 0 ? '#f59e0b' : '#dc2626';
  }

  const profitIcon = document.getElementById('profitIcon');
  if (profitIcon) {
    profitIcon.style.background = actualProfit >= 0
      ? 'linear-gradient(135deg,#22c55e,#16a34a)'
      : 'linear-gradient(135deg,#ef4444,#dc2626)';
  }

  const expensesEl = document.getElementById('totalExpenses');
  const expensesBreakdown = document.getElementById('expensesBreakdown');
  if (expensesEl) expensesEl.textContent = '₱' + totalExpenses.toLocaleString();
  if (expensesBreakdown) {
    const orderCount = orders.filter(o => o.budgetInfo && o.budgetInfo.expenses && o.budgetInfo.expenses.length > 0).length;
    expensesBreakdown.textContent = orderCount > 0
      ? 'Across ' + orderCount + ' order' + (orderCount > 1 ? 's' : '')
      : 'No expenses recorded yet';
  }

  const boatSalesEl = document.getElementById('boatSalesValue');
  const installmentEl = document.getElementById('installmentValue');
  const fullPaymentEl = document.getElementById('fullPaymentValue');
  const goalPercentEl = document.getElementById('goalPercent');

  const installmentTotal = orders.filter(o => (o.paymentMethod || '').toLowerCase() === 'installment').reduce((s, o) => s + cleanPrice(o.boatPrice || o.price), 0);
  const fullTotal = orders.filter(o => !o.paymentMethod || o.paymentMethod.toLowerCase() === 'full payment').reduce((s, o) => s + cleanPrice(o.boatPrice || o.price), 0);

  if (boatSalesEl) boatSalesEl.textContent = '₱' + (totalRevenue / 1000000).toFixed(1) + 'M';
  if (installmentEl) installmentEl.textContent = '₱' + (installmentTotal / 1000000).toFixed(1) + 'M';
  if (fullPaymentEl) fullPaymentEl.textContent = '₱' + (fullTotal / 1000000).toFixed(1) + 'M';

  const goal = 16000000;
  const pct = Math.min(100, Math.round((totalRevenue / goal) * 100));
  if (goalPercentEl) goalPercentEl.textContent = pct + '%';
  const circleChart = document.getElementById('circleChart');
  if (circleChart) {
    circleChart.style.background = 'conic-gradient(#2563eb 0% ' + pct + '%, #e5e7eb ' + pct + '% 100%)';
  }

  renderTransactions(orders, payments);
  renderSalesTable(orders, payments);
}

function renderTransactions(orders, payments) {
  const container = document.getElementById('transactionsContainer');
  if (!container) return;

  const all = [];
  orders.forEach(o => {
    const p = cleanPrice(o.boatPrice || o.price);
    if (p > 0) {
      all.push({
        img: o.boatImage || './images/boat1.jpg',
        boat: o.boatName || 'Boat',
        customer: o.customerName || o.name || 'Unknown',
        price: '₱' + p.toLocaleString(),
        status: o.status === 'Completed' ? 'Paid' : o.status === 'Approved' ? 'Active' : (o.status === 'Pending' || o.status === 'Pending Signing' ? 'Pending' : o.status),
        statusClass: o.status === 'Completed' ? 'paid-status' : (o.status === 'Approved' ? 'paid-status' : (o.status === 'Cancelled' ? 'pending-status' : 'pending-status')),
        date: o.date || o.createdAt || ''
      });
    }
  });
  payments.forEach(p => {
    const amt = cleanPrice(p.amountPaid || p.amount);
    if (amt > 0) {
      all.push({
        img: p.boatImage || './images/boat1.jpg',
        boat: p.boatName || 'Payment',
        customer: p.customerName || 'Unknown',
        price: '₱' + amt.toLocaleString(),
        status: p.status === 'Approved' ? 'Paid' : (p.status === 'Pending' ? 'Pending' : p.status || 'Pending'),
        statusClass: p.status === 'Approved' ? 'paid-status' : (p.status === 'Pending' ? 'pending-status' : 'pending-status'),
        date: p.submittedDate || p.createdAt || ''
      });
    }
  });

  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = all.slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;">No transactions yet.</div>';
    return;
  }

  container.innerHTML = recent.map(t => `
    <div class="transaction-item">
      <img src="${t.img}">
      <div class="transaction-info">
        <h4>${t.boat}</h4>
        <p>${t.customer}</p>
      </div>
      <div class="transaction-price">${t.price}</div>
      <span class="${t.statusClass}">${t.status}</span>
    </div>
  `).join('');
}

function renderSalesTable(orders, payments) {
  const tbody = document.getElementById('salesTableBody');
  if (!tbody) return;

  const rows = [];
  orders.forEach(o => {
    const p = cleanPrice(o.boatPrice || o.price);
    if (p > 0) {
      rows.push({
        customer: o.customerName || o.name || 'Unknown',
        boat: o.boatName || 'Boat',
        method: o.paymentMethod || 'N/A',
        amount: '₱' + p.toLocaleString(),
        status: o.status === 'Completed' ? 'Paid' : (o.status === 'Approved' ? 'Active' : o.status || 'Pending'),
        date: o.date || o.createdAt || new Date().toLocaleDateString()
      });
    }
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#94a3b8;">No sales data yet.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.customer}</td>
      <td>${r.boat}</td>
      <td>${r.method}</td>
      <td>${r.amount}</td>
      <td><span class="${r.status === 'Paid' || r.status === 'Active' ? 'paid-status' : 'pending-status'}">${r.status}</span></td>
      <td>${r.date}</td>
    </tr>
  `).join('');
}

loadSalesData();

const exportBtn = document.getElementById('exportBtn');
exportBtn?.addEventListener('click', () => {
  const orders = JSON.parse(localStorage.getItem('boatOrders') || '[]');
  const payments = JSON.parse(localStorage.getItem('dashboardPayments') || '[]');

  if (typeof XLSX === 'undefined') {
    const escCsv = v => '"' + String(v).replace(/"/g, '""') + '"';
    let csv = 'Customer,Boat Type,Price,Status,Date\n';
    orders.forEach(o => {
      csv += escCsv(o.customerName || o.name || 'Unknown') + ',' +
             escCsv(o.boatName || 'Boat') + ',' +
             escCsv(o.boatPrice || o.price || '0') + ',' +
             escCsv(o.status || 'Pending') + ',' +
             escCsv(o.date || o.createdAt || new Date().toLocaleDateString()) + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sales_report_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const data = [];
  data.push(['Customer', 'Boat Type', 'Price', 'Payment Method', 'Status', 'Date']);
  orders.forEach(o => {
    data.push([
      o.customerName || o.name || 'Unknown',
      o.boatName || 'Boat',
      o.boatPrice || o.price || '0',
      o.paymentMethod || 'N/A',
      o.status || 'Pending',
      o.date || o.createdAt || new Date().toLocaleDateString()
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  XLSX.writeFile(wb, 'sales_report_' + new Date().toISOString().slice(0, 10) + '.xlsx');
});
