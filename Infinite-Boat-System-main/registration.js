import { supabase, API_BASE } from "./supabase.js";

const DEFAULT_PROFILE = "./images/user.png";

// A real email needs a local part, a domain, and a TLD of at least two letters.
// Rejects troll entries such as "a@b", "a@@b.com", "name @mail.com" or "x@y.".
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
// Strict PH mobile format: exactly 11 digits starting with 09 (used by the
// server-side check; the client validates the 10-digit national form).
const PHONE_RE = /^09\d{9}$/;

// The field shows a fixed "+63" prefix, so the user only types the 10-digit
// national number (e.g. 929 892 3897). Pasted international numbers are
// normalized to that same 10-digit form.
function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("63")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

// Full stored value: the national form with the trunk 0 (09XXXXXXXXX).
function toStoredPhone(value) {
  const national = normalizePhone(value);
  return national ? "0" + national : "";
}

const FIELD_IDS = ["fullname", "email", "phone", "password", "confirmPassword"];

// Per-field UI state. `touched` becomes true once the user leaves the field
// (or submits), which is when live re-validation on every keystroke starts.
const fieldState = {};
FIELD_IDS.forEach(function (id) {
  fieldState[id] = { touched: false, invalid: false };
});

function getInput(id) {
  return document.getElementById(id);
}

function getValue(id) {
  const input = getInput(id);
  return input ? input.value.trim() : "";
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

// Each validator returns an error message, or "" when the field is valid.
const validators = {
  fullname: function () {
    const value = getValue("fullname");
    if (value === "") return "Please enter your full name.";
    return "";
  },

  email: function () {
    const value = getValue("email");
    if (value === "") return "Email address is required.";
    if (!isValidEmail(value)) return "Enter a valid email address (e.g. juan@example.com).";
    return "";
  },

  phone: function () {
    const national = normalizePhone(getValue("phone"));
    if (national === "") return "Phone number is required.";
    if (!PHONE_RE.test("0" + national)) return "Enter your 10-digit mobile number (e.g. 929 892 3897).";
    return "";
  },

  password: function () {
    const value = getInput("password") ? getInput("password").value : "";
    if (value === "") return "Password is required.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    return "";
  },

  confirmPassword: function () {
    const password = getInput("password") ? getInput("password").value : "";
    const confirm = getInput("confirmPassword") ? getInput("confirmPassword").value : "";
    if (confirm === "") return "Please confirm your password.";
    if (password !== confirm) return "Passwords do not match.";
    return "";
  },
};

function validateField(id) {
  const validator = validators[id];
  return validator ? validator() : "";
}

// Paints the field: red error message when invalid, green check when valid.
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

// Neutral state: no red border and no green check (used while the user is
// still typing something that cannot be judged yet).
function clearFieldFeedback(id) {
  const input = getInput(id);
  const error = document.getElementById(id + "Error");
  const state = fieldState[id];

  if (input) {
    input.classList.remove("input-invalid", "input-valid");
    input.removeAttribute("aria-invalid");
  }
  if (error) {
    error.textContent = "";
    error.classList.remove("show");
  }
  if (state) state.invalid = false;
}

function clearAllErrors() {
  FIELD_IDS.forEach(function (id) {
    const state = fieldState[id];
    state.touched = false;
    state.invalid = false;
    clearFieldFeedback(id);
  });
}

// Weak / Fair / Strong hint shown while typing a password.
function getPasswordStrength(value) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (value.length < 8 || score <= 1) return { level: "weak", label: "Weak" };
  if (score <= 3) return { level: "fair", label: "Fair" };
  return { level: "strong", label: "Strong" };
}

function updatePasswordStrength() {
  const meter = document.getElementById("passwordStrength");
  const input = getInput("password");
  if (!meter || !input) return;

  if (input.value === "") {
    meter.classList.remove("show");
    return;
  }

  const strength = getPasswordStrength(input.value);
  const fill = meter.querySelector(".strength-fill");
  const label = meter.querySelector(".strength-label");

  meter.classList.add("show");
  if (fill) fill.className = "strength-fill " + strength.level;
  if (label) {
    label.className = "strength-label " + strength.level;
    label.textContent = "Password strength: " + strength.label;
  }
}

// Eye button: toggles a single password field so the user can review what
// they typed without revealing both password fields at once.
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

// Kept for backwards compatibility with older markup that may still call it.
window.showPass = function () {
  const input = getInput("password");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
};

function setSubmitting(isSubmitting) {
  const submitBtn = document.getElementById("signupBtn");
  if (!submitBtn) return;

  submitBtn.disabled = isSubmitting;
  submitBtn.setAttribute("aria-busy", isSubmitting ? "true" : "false");
  submitBtn.innerHTML = isSubmitting
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Creating account...</span>'
    : '<span>Create Account</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
}

window.validateForm = async function () {
  let firstInvalidId = "";

  FIELD_IDS.forEach(function (id) {
    fieldState[id].touched = true;
    const message = validateField(id);
    applyFieldState(id, message);
    if (message && !firstInvalidId) firstInvalidId = id;
  });

  if (firstInvalidId) {
    const input = getInput(firstInvalidId);
    if (input) input.focus();
    return;
  }

  const fullname = getValue("fullname");
  const email = getValue("email");
  const phone = toStoredPhone(getValue("phone"));
  const password = getInput("password").value;

  setSubmitting(true);

  try {
    const res = await fetch(API_BASE + "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.toLowerCase(), password, fullname, phone }),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = result.error || "Registration failed.";
      if (/email/i.test(message)) {
        fieldState.email.touched = true;
        applyFieldState("email", message);
        getInput("email")?.focus();
      } else if (/phone/i.test(message)) {
        fieldState.phone.touched = true;
        applyFieldState("phone", message);
        getInput("phone")?.focus();
      } else {
        alert(message);
      }
      return;
    }

    if (result.emailSent === false) {
      await showToast({
        title: "Account created",
        text: result.message || "The confirmation email could not be sent — use Resend Verification on the login page.",
        variant: "warning",
        duration: 1700,
      });
      window.location.href = "login.html";
      return;
    }

    await showToast({
      title: "Registration successful",
      text: "Please check your email to confirm your account.",
      duration: 1500,
    });
    window.location.href = "login.html";
  } catch (error) {
    console.log(error);
    alert("Unable to connect to server. Make sure the server is running.");
  } finally {
    setSubmitting(false);
  }
};

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    await validateForm();
  });
}

// Digits only while typing or pasting. Pasted "+63..." or "09..." values are
// reduced to the 10-digit national form so it lines up with the visible prefix.
const phoneInput = getInput("phone");
if (phoneInput) {
  phoneInput.addEventListener("input", function () {
    const raw = phoneInput.value;
    const next = normalizePhone(raw);

    if (raw !== next) {
      // Preserve the caret as closely as possible while rewriting the value.
      const caret = phoneInput.selectionStart == null ? raw.length : phoneInput.selectionStart;
      const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length;
      phoneInput.value = next;
      if (typeof phoneInput.setSelectionRange === "function") {
        const position = Math.min(digitsBeforeCaret, next.length);
        phoneInput.setSelectionRange(position, position);
      }
    }
  });

  phoneInput.addEventListener("blur", function () {
    const normalized = normalizePhone(phoneInput.value);
    if (phoneInput.value !== normalized) phoneInput.value = normalized;
  });
}

// Live validation: first check on blur, then re-check on every keystroke so a
// corrected field turns green (or drops its error) before the user submits.
FIELD_IDS.forEach(function (id) {
  const input = getInput(id);
  if (!input) return;

  input.addEventListener("blur", function () {
    fieldState[id].touched = true;
    applyFieldState(id, validateField(id));
    if (id === "password") updatePasswordStrength();
  });

  input.addEventListener("input", function () {
    const state = fieldState[id];

    if (id === "confirmPassword") {
      const password = getInput("password");
      const typed = input.value;
      const enoughTyped = !password || password.value === "" || typed.length >= password.value.length;

      // Do not nag while the user is still typing a shorter confirmation.
      if (!enoughTyped) {
        if (state.touched) clearFieldFeedback(id);
        return;
      }
      if (!state.touched && typed === "") return;

      applyFieldState(id, validateField(id));
      return;
    }

    if (!state.touched) return;

    applyFieldState(id, validateField(id));

    if (id === "password") {
      updatePasswordStrength();
      const confirm = getInput("confirmPassword");
      if (confirm && confirm.value !== "") {
        fieldState.confirmPassword.touched = true;
        applyFieldState("confirmPassword", validateField("confirmPassword"));
      }
    }
  });
});

updatePasswordStrength();
