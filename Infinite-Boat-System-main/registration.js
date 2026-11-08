import { supabase, API_BASE } from "./supabase.js";

const DEFAULT_PROFILE = "./images/user.png";

window.validateForm = async function () {
  const fullname = document.getElementById("fullname").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();

  if (fullname === "") {
    alert("Please enter your full name.");
    return;
  }

  if (email === "") {
    alert("Please enter your email.");
    return;
  }

  if (!email.includes("@")) {
    alert("Please enter valid email.");
    return;
  }

  if (phone === "") {
    alert("Please enter your phone number.");
    return;
  }

  if (password.length < 8) {
    alert("Password must be at least 8 characters.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  const submitBtn = document.querySelector("#registerForm button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Registering...";
  }

  try {
    const res = await fetch(API_BASE + "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullname, phone }),
    });

    const result = await res.json();

    if (!res.ok) {
      alert(result.error || "Registration failed.");
      return;
    }

    if (result.emailSent === false) {
      alert(result.message || "Account created, but the confirmation email could not be sent. Please use Resend Verification on the login page.");
      window.location.href = "login.html";
      return;
    }

    alert(result.message || "Registration successful! Please check your email to confirm your account.");
    window.location.href = "login.html";
  } catch (error) {
    console.log(error);
    alert("Unable to connect to server. Make sure the server is running.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Register";
    }
  }
};

window.showPass = function () {
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");

  if (password.type === "password") {
    password.type = "text";
    confirmPassword.type = "text";
  } else {
    password.type = "password";
    confirmPassword.type = "password";
  }
};

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    await validateForm();
  });
}
