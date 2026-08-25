import { supabase, API_BASE } from "./supabase.js";

window.login = async function () {
  let email = document.getElementById("email").value.trim();
  let password = document.getElementById("password").value.trim();

  if (email === "" || password === "") {
    alert("Please fill all fields.");
    return;
  }

  if (!email.includes("@")) {
    alert("Please enter a valid email address.");
    return;
  }

  localStorage.clear();

  await supabase.auth.signOut();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("email not confirmed") || error.message?.toLowerCase().includes("email not verified")) {
      document.getElementById("verifyMessage").style.display = "block";
      document.getElementById("resendLink").dataset.email = email;
    } else {
      alert(error.message);
    }
    console.log(error);
    return;
  }

  const user = data.user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, photo, role, phone")
    .eq("id", user.id)
    .single();

  localStorage.setItem("customerName", profile?.name || user.user_metadata?.name || user.email.split('@')[0] || user.email);
  localStorage.setItem("customerEmail", user.email);
  localStorage.setItem("userId", user.id);
  localStorage.setItem("customerImage", profile?.photo || "./images/user.png");
  localStorage.setItem("customerPhone", profile?.phone || "");

  const userRole = profile?.role || user?.user_metadata?.role || "user";

  if (userRole === "admin") {
    alert("Welcome Admin!");
    localStorage.setItem("role", "admin");
    window.location.href = "dashboard.html";
  } else if (userRole === "worker") {
    const { data: regStatus } = await supabase
      .from("worker_registrations")
      .select("status")
      .eq("userId", user.id)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (regStatus && regStatus.status === "pending") {
      alert("Your account is pending admin approval. You will receive an email once approved.");
      await supabase.auth.signOut();
      return;
    }

    if (regStatus && regStatus.status === "rejected") {
      alert("Your registration has been rejected. Please contact admin for details.");
      await supabase.auth.signOut();
      return;
    }

    alert("Welcome Worker!");
    localStorage.setItem("role", "worker");
    window.location.href = "worker.html";
  } else {
    alert("Login Successful!");
    localStorage.setItem("role", "user");
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

window.showPass = function () {
  let pass = document.getElementById("password");
  if (pass.type === "password") {
    pass.type = "text";
  } else {
    pass.type = "password";
  }
};


