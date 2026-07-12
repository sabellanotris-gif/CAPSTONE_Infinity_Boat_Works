import { supabase } from "./supabase.js";

window.handleLogout = async function () {
  supabase.auth.signOut().then(() => {
    localStorage.clear();
    window.location.href = "index.html";
  });
};

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function customerToData(profile, boatDisplay) {
    return {
        name: esc(profile.name || profile.email || 'Unknown'),
        email: esc(profile.email || ''),
        phone: esc(profile.phone || 'N/A'),
        boat: esc(boatDisplay),
        photo: profile.photo || './images/user.png'
    };
}

async function loadCustomers() {
    const tbody = document.getElementById('customerTable');
    if (!tbody) return;

    try {
        const [profilesResult, ordersResult] = await Promise.all([
            supabase.from("profiles").select("*").order("created_at", { ascending: false }),
            supabase.from("boat_orders").select("customerEmail")
        ]);

        if (profilesResult.error) throw profilesResult.error;

        const profiles = profilesResult.data || [];
        const orders = ordersResult.data || [];

        const boatCounts = {};
        orders.forEach(o => {
            const email = (o.customerEmail || '').toLowerCase();
            boatCounts[email] = (boatCounts[email] || 0) + 1;
        });

        if (profiles.length > 0) {
            tbody.innerHTML = '';
            profiles.filter(p => p.role !== 'admin').forEach((profile) => {
                const email = (profile.email || '').toLowerCase();
                const count = boatCounts[email] || 0;
                const boatDisplay = count > 0 ? count + ' boat' + (count > 1 ? 's' : '') : 'None';
                const d = customerToData(profile, boatDisplay);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="customer-cell">
                        <img src="${d.photo}" onerror="this.src='./images/user.png'">
                        <div>
                            <h4>${d.name}</h4>
                            <p>${d.email}</p>
                        </div>
                    </td>
                    <td>${d.phone}</td>
                    <td>${d.boat}</td>
                    <td><span class="verified">Verified</span></td>
                    <td><button class="view-btn" data-name="${d.name}" data-email="${d.email}" data-phone="${d.phone}" data-boat="${d.boat}">View</button></td>
                `;
                tbody.appendChild(tr);
            });
            updateStats(profiles.length);
        } else {
            loadCustomersFromLocal();
        }
    } catch (e) {
        console.log('Supabase unavailable, using local data');
        loadCustomersFromLocal();
    }
}

function loadCustomersFromLocal() {
    const tbody = document.getElementById('customerTable');
    if (!tbody) return;
    const orders = JSON.parse(localStorage.getItem('boatOrders') || '[]');
    const customerMap = {};
    orders.forEach(o => {
        const email = o.email || o.customerEmail || 'unknown@email.com';
        if (!customerMap[email]) {
            customerMap[email] = { email: esc(email), name: esc(o.name || o.customerName || email.split('@')[0]), phone: esc(o.phone || 'N/A'), boat: esc(o.boatName || o.name || 'N/A') };
        }
    });
    tbody.innerHTML = '';
    Object.values(customerMap).forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="customer-cell">
                <img src="./images/user.png">
                <div>
                    <h4>${c.name}</h4>
                    <p>${c.email}</p>
                </div>
            </td>
            <td>${c.phone}</td>
            <td>${c.boat}</td>
            <td><span class="verified">Verified</span></td>
            <td><button class="view-btn" data-name="${c.name}" data-email="${c.email}" data-phone="${c.phone}" data-boat="${c.boat}">View</button></td>
        `;
        tbody.appendChild(tr);
    });
    updateStats(Object.keys(customerMap).length);
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    const name = btn.dataset.name;
    const email = btn.dataset.email;
    const phone = btn.dataset.phone;
    const boat = btn.dataset.boat;
    if (name) viewCustomerModal(name, email, phone, boat);
});

function updateStats(count) {
    const totalEl = document.querySelector('.stat-card:nth-child(1) h2');
    if (totalEl) totalEl.textContent = count;
    const verifiedEl = document.querySelector('.stat-card:nth-child(2) h2');
    if (verifiedEl) verifiedEl.textContent = count;
    const pendingEl = document.querySelector('.stat-card:nth-child(3) h2');
    if (pendingEl) pendingEl.textContent = '0';
}

loadCustomers();

document.getElementById('searchInput')?.addEventListener('input', function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll('#customerTable tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
});
