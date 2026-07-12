import { supabase, handleDbError } from "./supabase.js";

window.handleLogout = async function () {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = "index.html";
};

let selectedImages = [];
let generatedVideos = [];

(async function init() {
  await loadCustomers();
  loadHistory();
  bindEvents();
})();

async function loadCustomers() {
  const { data: orders } = await handleDbError(
    supabase.from("boat_orders").select("customerName, customerEmail").not("customerName", "is", null),
    "Load customers"
  );
  const select = document.getElementById("customerSelect");
  if (!orders || orders.length === 0) {
    select.innerHTML = '<option>No customers found</option>';
    return;
  }
  const seen = new Set();
  select.innerHTML = '<option value="">Select Customer</option>';
  orders.forEach(o => {
    const name = o.customerName?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  });
}

function bindEvents() {
  document.getElementById("generateBtn")?.addEventListener("click", generateVideo);
  document.getElementById("previewBtn")?.addEventListener("click", previewVideo);
  document.getElementById("uploadBtn")?.addEventListener("click", uploadVideo);
  document.getElementById("boatImages")?.addEventListener("change", handleImagePreview);
}

function handleImagePreview(e) {
  const files = Array.from(e.target.files);
  selectedImages = files;
  const container = document.getElementById("preview-container");
  container.innerHTML = "";
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = document.createElement("img");
      img.src = ev.target.result;
      img.style.width = "80px";
      img.style.height = "80px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "8px";
      img.style.margin = "4px";
      container.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function generateVideo() {
  const customer = document.getElementById("customerSelect")?.value;
  const title = document.getElementById("reportTitle")?.value.trim() || "Progress Report";
  const theme = document.getElementById("videoTheme")?.value || "Luxury Marine";

  if (!customer || customer === "Select Customer" || customer === "No customers found") {
    alert("Please select a customer.");
    return;
  }

  const btn = document.getElementById("generateBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

  const fill = document.getElementById("progressFill");
  const text = document.getElementById("progressText");

  for (let p = 0; p <= 100; p += Math.floor(Math.random() * 8) + 3) {
    const prog = Math.min(p, 100);
    fill.style.width = prog + "%";
    text.textContent = prog + "%";
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
  }

  fill.style.width = "100%";
  text.textContent = "100%";

  const videoEntry = {
    id: Date.now().toString(),
    customer,
    title,
    theme,
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    status: "Completed",
    images: selectedImages.length
  };

  generatedVideos.unshift(videoEntry);
  saveHistory();
  renderHistory();

  document.getElementById("previewTitle").textContent = title;
  document.getElementById("previewStatus").textContent = "Status: Completed";

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate AI Video';

  showToast("Video generated successfully!", "success");
}

function previewVideo() {
  const video = document.querySelector(".preview-panel video");
  if (video) {
    if (video.paused) video.play();
    else video.pause();
  }
}

async function uploadVideo() {
  const video = document.querySelector(".preview-panel video source");
  if (!video) return;

  try {
    const response = await fetch(video.src);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai_video_report.mp4";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Video downloaded!", "success");
  } catch {
    alert("Could not download the video preview.");
  }
}

function saveHistory() {
  localStorage.setItem("aiVideoHistory", JSON.stringify(generatedVideos));
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem("aiVideoHistory") || "[]");
    generatedVideos = saved;
  } catch { generatedVideos = []; }
  renderHistory();
}

function renderHistory() {
  const tbody = document.getElementById("historyBody");
  if (!tbody) return;
  if (generatedVideos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#888;">No videos generated yet.</td></tr>';
    return;
  }
  tbody.innerHTML = generatedVideos.map(v => `
    <tr>
      <td>${esc(v.customer)}</td>
      <td>${esc(v.title)}</td>
      <td>${esc(v.date)}</td>
      <td><span class="status completed">${esc(v.status)}</span></td>
      <td><button onclick="alert('Viewing: ${esc(v.title)}')">View</button></td>
    </tr>
  `).join("");
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function showToast(msg, type) {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-weight:500;z-index:9999;animation:fadeIn 0.3s;background:${type === "success" ? "#22c55e" : "#ef4444"};`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity 0.3s"; setTimeout(() => toast.remove(), 300); }, 2500);
}
