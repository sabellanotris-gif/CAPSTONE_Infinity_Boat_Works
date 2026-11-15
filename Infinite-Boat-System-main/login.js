import { supabase, API_BASE } from "./supabase.js";

// Same strict email rule used on the registration page: a real local part,
// domain, and a TLD of at least two letters.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const FIELD_IDS = ["email", "password"];

// `touched` flips on blur (or submit); after that the field re-validates on
// every keystroke so errors clear as soon as the input becomes valid.
const fieldState = {};
FIELD_IDS.forEach(function (id) {
  fieldState[id] = { touched: false, invalid: false };
});

function getInput(id) {
  return document.getElementById(id);
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  if (email.includes("..")) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  return EMAIL_RE.test(email);
}

const validators = {
  email: function () {
    const input = getInput("email");
    const value = input ? input.value.trim() : "";
    if (value === "") return "Email address is required.";
    if (!isValidEmail(value)) return "Enter a valid email address (e.g. juan@example.com).";
    return "";
  },

  password: function () {
    const input = getInput("password");
    if (!input || input.value === "") return "Password is required.";
    return "";
  },
};

function validateField(id) {
  const validator = validators[id];
  return validator ? validator() : "";
}

function applyFieldState(id, message) {
  const input = getInput(id);
  if (!input) return;

  const error = document.getElementById(id + "Error");
  const state = fieldState[id] || (fieldState[id] = { touched: false, invalid: false });
  state.invalid = Boolean(message);

  if (message) {
    input.classList.add("input-invalid");
    input.classList.remove("input-valid");
    input.setAttribute("aria-invalid", "true");
    if (error) {
      error.textContent = message;
      error.classList.add("show");
    }
    return;
  }

  input.classList.remove("input-invalid");
  input.removeAttribute("aria-invalid");
  input.classList.toggle("input-valid", input.value.trim() !== "");
  if (error) {
    error.textContent = "";
    error.classList.remove("show");
  }
}

function setLoginLoading(isLoading) {
  const btn = document.getElementById("loginBtn");
  if (!btn) return;
  btn.disabled = isLoading;
  btn.setAttribute("aria-busy", isLoading ? "true" : "false");
  btn.innerHTML = isLoading
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Logging in...</span>'
    : '<i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i><span>Log In</span>';
}

// Eye button so the user can review the password they typed.
window.togglePassword = function (inputId, button) {
  const input = getInput(inputId);
  if (!input) return;

  const show = input.type === "password";
  input.type = show ? "text" : "password";

  if (button) {
    button.setAttribute("aria-pressed", show ? "true" : "false");
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    const icon = button.querySelector("i");
    if (icon) icon.className = show ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
  }
};

window.login = async function () {
  let firstInvalidId = "";

  FIELD_IDS.forEach(function (id) {
    fieldState[id].touched = true;
    const message = validateField(id);
    applyFieldState(id, message);
    if (message && !firstInvalidId) firstInvalidId = id;
  });

  if (firstInvalidId) {
    getInput(firstInvalidId)?.focus();
    return;
  }

  const email = getInput("email").value.trim();
  const password = getInput("password").value;

  setLoginLoading(true);

  let authResult;
  try {
    authResult = await supabase.auth.signInWithPassword({
      email,
      password,
    });
  } catch (err) {
    setLoginLoading(false);
    console.error(err);
    alert("Unable to connect. Please check your internet connection and try again.");
    return;
  }

  const { data, error } = authResult;

  if (error) {
    const msg = (error.message || "").toLowerCase();
    const isAuthFailure =
      msg.includes("invalid login credentials") ||
      msg.includes("invalid login") ||
      msg.includes("email not confirmed") ||
      msg.includes("email not verified") ||
      msg.includes("password") ||
      msg.includes("too many requests") ||
      msg.includes("locked");

    if (isAuthFailure) {
// Only now — after a genuinely failed attempt — clear any stale session.
  // Landing on this page by itself (e.g. a guard bounce) must NOT destroy
  // an otherwise-valid session or the customer's local state.
  localStorage.clear();
  sessionStorage.clear();
  await supabase.auth.signOut();
    } else {
      console.warn("[LOGIN] Transient failure — preserving existing session:", msg);
    }

    if (msg.includes("email not confirmed") || msg.includes("email not verified")) {
      document.getElementById("verifyMessage").style.display = "block";
      document.getElementById("resendLink").dataset.email = email;
    } else if (msg.includes("invalid login credentials") || msg.includes("invalid login")) {
      // Bad credentials are user input, so show the message inline instead of
      // an alert box.
      fieldState.password.touched = true;
      applyFieldState("password", "Incorrect email or password.");
      getInput("password")?.focus();
    } else {
      alert(error.message);
    }
    console.log(error);
    setLoginLoading(false);
    return;
  }

  const user = data.user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, photo, role, phone")
    .eq("id", user.id)
    .single();

  sessionStorage.setItem("customerName", profile?.name || user.user_metadata?.name || user.email.split('@')[0] || user.email);
  sessionStorage.setItem("customerEmail", user.email);
  sessionStorage.setItem("userId", user.id);
  sessionStorage.setItem("customerImage", profile?.photo || "./images/user.png");
  sessionStorage.setItem("customerPhone", profile?.phone || "");

  const userRole = profile?.role || user?.user_metadata?.role || "customer";

  if (userRole === "admin") {
    sessionStorage.setItem("role", "admin");
    sessionStorage.setItem("currentUser", JSON.stringify({
      name: profile?.name || user.user_metadata?.name || user.email.split('@')[0] || user.email,
      email: user.email,
      photo: profile?.photo || "./images/user.png",
    }));
    await showToast({ title: "Welcome back", text: "Signed in as Admin" });
    window.location.href = "dashboard.html";
  } else if (userRole === "manager") {
    sessionStorage.setItem("role", "manager");
    sessionStorage.setItem("currentUser", JSON.stringify({
      name: profile?.name || user.user_metadata?.name || user.email.split('@')[0] || user.email,
      email: user.email,
      photo: profile?.photo || "./images/user.png",
    }));
    await showToast({ title: "Welcome back", text: "Signed in as Project Manager" });
    window.location.href = "manager.html";
  } else if (userRole === "worker") {
    const { data: regStatus } = await supabase
      .from("worker_registrations")
      .select("status")
      .eq("userId", user.id)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (regStatus && regStatus.status === "pending") {
      await supabase.auth.signOut();
      setLoginLoading(false);
      showToast({
        title: "Account pending",
        text: "Your account is waiting for admin approval.",
        variant: "warning",
        duration: 4000,
      });
      return;
    }

    if (regStatus && regStatus.status === "rejected") {
      await supabase.auth.signOut();
      setLoginLoading(false);
      showToast({
        title: "Registration rejected",
        text: "Please contact the admin for details.",
        variant: "warning",
        duration: 4000,
      });
      return;
    }

    sessionStorage.setItem("role", "worker");
    await showToast({ title: "Welcome back", text: "Signed in as Worker" });
    window.location.href = "worker.html";
  } else {
    sessionStorage.setItem("role", "customer");
    await showToast({ title: "Login successful", text: "Welcome back to Infinity Boat Work" });
    window.location.href = "home.html";
  }
};

window.resendVerification = async function (email) {
  const link = document.getElementById("resendLink");
  const status = document.getElementById("resendStatus");
  link.style.display = "none";
  status.style.display = "inline";
  status.textContent = "Sending...";

  try {
    const res = await fetch(API_BASE + "/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const result = await res.json();

    if (res.ok) {
      status.textContent = "Verification email sent! Check your inbox.";
    } else {
      status.textContent = result.error || "Failed to resend.";
    }
  } catch (err) {
    status.textContent = "Unable to connect to server.";
  }
};

document.getElementById("resendLink")?.addEventListener("click", function (e) {
  e.preventDefault();
  const email = this.dataset.email;
  if (email) window.resendVerification(email);
});

window.googleLogin = async function () {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/login.html",
    },
  });

  if (error) {
    console.log(error);
    alert(error.message);
  }
};

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  login();
});

// Live validation: check on blur, then keep the field honest on every keystroke.
FIELD_IDS.forEach(function (id) {
  const input = getInput(id);
  if (!input) return;

  input.addEventListener("blur", function () {
    fieldState[id].touched = true;
    applyFieldState(id, validateField(id));
  });

  input.addEventListener("input", function () {
    if (!fieldState[id].touched) return;
    applyFieldState(id, validateField(id));
  });
});

// Kept for backwards compatibility with older markup that may still call it.
window.showPass = function () {
  const pass = getInput("password");
  if (!pass) return;
  pass.type = pass.type === "password" ? "text" : "password";
};
