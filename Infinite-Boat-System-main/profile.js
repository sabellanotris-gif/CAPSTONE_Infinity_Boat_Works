import { supabase } from "./supabase.js";

let currentUser = null;
let currentImage = "./images/user.png";

const displayName = document.getElementById("displayName");
const profilePic = document.getElementById("profilePic");
const imageInput = document.getElementById("imageInput");
const saveBtn = document.getElementById("saveProfileBtn");
const nameInput = document.getElementById("nameInput");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");

window.togglePasswordLocal = function(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  if (btn) {
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    var icon = btn.querySelector('i');
    if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  }
};

function getPasswordStrength(value) {
  var score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (value.length < 8 || score <= 1) return { level: 'weak', label: 'Weak' };
  if (score <= 3) return { level: 'fair', label: 'Fair' };
  return { level: 'strong', label: 'Strong' };
}
function updateProfileStrengthMeter() {
  var v = newPasswordInput.value;
  var bar = document.getElementById('profilePwStrength');
  var label = document.getElementById('profilePwStrengthLabel');
  if (!bar || !label) return;
  if (v === '') { bar.classList.remove('show'); label.textContent = ''; label.className = 'strength-label'; return; }
  var sm = getPasswordStrength(v);
  bar.classList.add('show');
  var fill = bar.querySelector('.strength-fill');
  if (fill) fill.className = 'strength-fill ' + sm.level;
  label.className = 'strength-label ' + sm.level;
  label.textContent = 'Strength: ' + sm.label;
}
document.addEventListener('DOMContentLoaded', function() {
  if (newPasswordInput) newPasswordInput.addEventListener('input', function() {
    updateProfileStrengthMeter();
    validateProfilePw();
  });
  if (confirmPasswordInput) confirmPasswordInput.addEventListener('input', validateProfilePw);
});
function setProfileError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || '';
}
function validateProfilePw() {
  var v = newPasswordInput.value;
  var barMsg = '';
  if (v !== '' && v.length < 8) barMsg = 'Password must be at least 8 characters.';
  else if (v !== '' && !/[A-Za-z]/.test(v) || v !== '' && !/\d/.test(v)) barMsg = 'Use letters and at least one number.';
  setProfileError('newPasswordError', barMsg);
  var c = confirmPasswordInput.value;
  var confirmMsg = (c !== '' && c !== v) ? 'Passwords do not match.' : '';
  setProfileError('confirmPasswordError', confirmMsg);
  return !barMsg && !confirmMsg;
}

async function checkAuth() {
  const auth = await window.requireRole(["customer", "user", "admin", "manager"]);
  if (!auth) return;
  currentUser = auth.session.user;
  sessionStorage.setItem("userId", currentUser.id);

  // Send admins/managers back to their role's landing page on close.
  const role = auth.profile?.role || sessionStorage.getItem("role") || "";
  const closeBtn = document.getElementById("profileCloseBtn");
  if (closeBtn) {
    const target = role === "admin" ? "dashboard.html"
      : role === "manager" ? "manager.html"
      : role === "worker" ? "worker.html"
      : "home.html";
    closeBtn.setAttribute("onclick", `window.location.href='${target}'`);
  }

  await loadProfile(currentUser.id);
}

supabase.auth.onAuthStateChange((event, session) => {
  // Only a real SIGNED_OUT ends the session. USER_UPDATED / TOKEN_REFRESHED /
  // password rotation must never bounce the user to the login page.
  if (event === "SIGNED_OUT") {
    window.location.href = "login.html";
    return;
  }
  // A live session from any other event just syncs the current user; the page
  // is guarded by checkAuth() on load, so no redirect here.
  if (session?.user) {
    currentUser = session.user;
    sessionStorage.setItem("userId", currentUser.id);
  }
});

checkAuth();

async function loadProfile(userId) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("name, photo, phone")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.log(error);
      return;
    }

    const fullname = data?.name || "Customer";
    const image = data?.photo || "./images/user.png";

    displayName.innerText = fullname;
    nameInput.value = fullname;

    const phoneInput = document.getElementById("phoneInput");
    if (phoneInput) phoneInput.value = data?.phone || "";

    currentImage = image;
    profilePic.src = image;

    sessionStorage.setItem("customerName", fullname);
    sessionStorage.setItem("customerImage", image);
    sessionStorage.setItem("customerPhone", data?.phone || "");
  } catch (error) {
    console.log(error);
    alert("Failed to load profile.");
  }
}

if (imageInput) {
  imageInput.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;

    if (file.size > 3000000) {
      alert("Image must be below 3MB.");
      return;
    }

    const reader = new FileReader();

    reader.onload = function (event) {
      const img = new Image();
      img.src = event.target.result;

      img.onload = function () {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const MAX_WIDTH = 400;
        const scaleSize = MAX_WIDTH / img.width;

        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        currentImage = canvas.toDataURL("image/jpeg", 0.7);
        profilePic.src = currentImage;
      };
    };

    reader.readAsDataURL(file);
  });
}

async function updateUserProfile() {
  if (!currentUser) {
    alert("User not logged in.");
    return;
  }

  const fullname = nameInput.value.trim();
  const phone = document.getElementById("phoneInput")?.value.trim() || "";
  const newPassword = newPasswordInput.value.trim();
  const confirmPassword = confirmPasswordInput.value.trim();

  if (fullname === "") {
    alert("Please enter your full name.");
    return;
  }

  if (!validateProfilePw() && newPassword !== "") {
    return;
  }

  try {
    saveBtn.disabled = true;
    saveBtn.innerHTML = "Saving...";

    const profileData = {
      name: fullname,
      phone: phone,
      photo: currentImage,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: profileError } = await supabase
      .from("profiles")
      .update(profileData)
      .eq("id", currentUser.id)
      .select();

    if (profileError) throw profileError;

    if (!updated || updated.length === 0) {
      const { error: insertError } = await supabase
        .from("profiles")
        .insert({ id: currentUser.id, ...profileData });

      if (insertError && insertError.code !== "23505") throw insertError;
    }

    if (newPassword !== "") {
      const { error: pwError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (pwError) throw pwError;
    }

    sessionStorage.setItem("customerName", fullname);
    sessionStorage.setItem("customerImage", currentImage);
    sessionStorage.setItem("customerPhone", phone);

    displayName.innerText = fullname;
    profilePic.src = currentImage;

    const homeName = document.getElementById("homeName");
    if (homeName) {
      homeName.innerText = fullname;
    }

    newPasswordInput.value = "";
    confirmPasswordInput.value = "";

    showToast({
      title: "Profile updated",
      text: "Your changes have been saved.",
      duration: 900,
    });

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (error) {
    console.log(error);
    alert(error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `
      <i class="fa-solid fa-floppy-disk"></i>
      Save Changes
    `;
  }
}

if (saveBtn) {
  saveBtn.addEventListener("click", updateUserProfile);
}
