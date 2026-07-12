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

async function checkAuth() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    localStorage.setItem("userId", currentUser.id);
    await loadProfile(currentUser.id);
  } else {
    window.location.href = "login.html";
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    currentUser = session.user;
    localStorage.setItem("userId", currentUser.id);
    loadProfile(currentUser.id);
  } else {
    window.location.href = "login.html";
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

    localStorage.setItem("customerName", fullname);
    localStorage.setItem("customerImage", image);
    localStorage.setItem("customerPhone", data?.phone || "");
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

  if (newPassword !== "" && newPassword.length < 6) {
    alert("Password must be at least 6 characters.");
    return;
  }

  if (newPassword !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  try {
    saveBtn.disabled = true;
    saveBtn.innerHTML = "Saving...";

    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: currentUser.id,
        name: fullname,
        phone: phone,
        photo: currentImage,
        updated_at: new Date().toISOString(),
      });

    if (profileError) throw profileError;

    if (newPassword !== "") {
      const { error: pwError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (pwError) throw pwError;
    }

    localStorage.setItem("customerName", fullname);
    localStorage.setItem("customerImage", currentImage);
    localStorage.setItem("customerPhone", phone);

    displayName.innerText = fullname;
    profilePic.src = currentImage;

    const homeName = document.getElementById("homeName");
    if (homeName) {
      homeName.innerText = fullname;
    }

    newPasswordInput.value = "";
    confirmPasswordInput.value = "";

    alert("Profile Updated Successfully");

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
