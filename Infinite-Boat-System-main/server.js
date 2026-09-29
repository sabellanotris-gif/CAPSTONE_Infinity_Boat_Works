require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabaseUrl = process.env.SUPABASE_URL || "https://brpblkvthpdfbjqckqbk.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasValidServiceRole = SERVICE_ROLE_KEY.length > 20 && !SERVICE_ROLE_KEY.includes("PASTE_YOUR");
const supabaseServiceRole = hasValidServiceRole
  ? createClient(supabaseUrl, SERVICE_ROLE_KEY)
  : null;

if (!hasValidServiceRole) {
  console.warn("[SERVER] No valid SUPABASE_SERVICE_ROLE_KEY set. Admin DB ops may fail for RLS-protected tables.");
}

const adminDb = supabaseServiceRole || supabase;

const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing authorization token" });

  const { data: { user }, error } = await adminDb.auth.getUser(token);
  if (error || !user) {
    console.error("[AUTH] Token validation failed:", error?.message || "No user returned");
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Read the profile with the service-role client so it is never blocked by RLS
  // and the request is guaranteed an accurate role. Fall back to the user's
  // own token client if the service-role lookup returns nothing.
  let profile = null;
  try {
    const { data: svcProfile } = await adminDb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    profile = svcProfile || null;
  } catch (e) {
    console.warn("[AUTH] Service-role profile fetch failed (non-fatal):", e?.message || e);
  }

  if (!profile) {
    try {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: "Bearer " + token } },
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: emailProfile } = await userClient
        .from("profiles")
        .select("*")
        .eq("email", user.email)
        .maybeSingle();
      profile = emailProfile || null;
    } catch (e) {
      console.warn("[AUTH] Profile fetch failed (non-fatal):", e?.message || e);
    }
  }

  req.user = user;
  req.profile = profile;
  next();
}

async function requireAdmin(req, res, next) {
  const isAdmin = req.profile?.role === "admin" || req.user?.user_metadata?.role === "admin";
  if (!isAdmin) {
    console.error("[AUTH] Admin check failed. Profile:", JSON.stringify(req.profile), "User meta:", JSON.stringify(req.user?.user_metadata));
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

async function requireAdminOrManager(req, res, next) {
  const role = req.profile?.role || req.user?.user_metadata?.role;
  if (role !== "admin" && role !== "manager") {
    return res.status(403).json({ error: "Admin or Project Manager access required" });
  }
  next();
}

/* ============ AUTH ============ */

app.post("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user, profile: req.profile });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, fullname, phone } = req.body;

    if (!email || !password || !fullname) {
      return res.status(400).json({ error: "Missing required fields: email, password, fullname" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (!supabaseServiceRole) {
      return res.status(500).json({ error: "Server not configured for registration." });
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");

    const { data: userData, error: userError } = await supabaseServiceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { name: fullname, verification_token: verificationToken },
    });

    if (userError) {
      if (userError.message?.includes("already registered") || userError.message?.includes("already exists")) {
        return res.status(409).json({ error: "Email already registered." });
      }
      return res.status(500).json({ error: userError.message });
    }

    const { error: profileError } = await supabaseServiceRole.from("profiles").upsert({
      id: userData.user.id,
      email,
      name: fullname,
      phone: phone || "",
      role: "customer",
    }, { onConflict: "id" });

    if (profileError) {
      console.error("[REGISTER] Profile upsert failed:", profileError);
    }

    let verifyLink = "";
    try {
      const { data: linkData, error: linkError } = await supabaseServiceRole.auth.admin.generateLink({
        type: "signup",
        email,
        password,
      });

      if (!linkError) {
        verifyLink = linkData?.properties?.action_link || "";
        if (verifyLink) {
          const serverHost = req.protocol + '://' + req.get('host');
          verifyLink = verifyLink.replace("redirect_to=http://localhost:3000", "redirect_to=" + serverHost + "/verification-success.html");
        }
      }
    } catch (err) {
      console.error("[REGISTER] Generate link failed:", err?.message || err);
    }

    if (!verifyLink) {
      verifyLink = `${process.env.SERVER_URL || "http://localhost:3000"}/api/auth/verify-email?token=${verificationToken}&uid=${userData.user.id}`;
    }

    sendEmail({
      to: email,
      subject: "Confirm Your Email — Infinity Boat Works",
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
          <h2 style="color:#1e3a5f;">Verify Your Email Address 🚢</h2>
          <p>Hi <strong>${escHtml(fullname)}</strong>,</p>
          <p>Thank you for registering! Please click the button below to confirm your email address and activate your account.</p>
          <p style="margin:24px 0;text-align:center">
            <a href="${verifyLink}"
               style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-size:16px">
              Confirm Email
            </a>
          </p>
          <p style="color:#888;font-size:12px;margin-top:20px">Infinity Boat Works · Smart Digital Boat System</p>
        </div>`
    }).catch(err => console.error("[REGISTER] Verification email send failed:", err));

    res.status(201).json({ success: true, message: "Registration successful! Please check your email to confirm your account." });
  } catch (err) {
    console.error("[REGISTER] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/verify-email", async (req, res) => {
  try {
    const { token, uid } = req.query;

    if (!token || !uid) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:40px">
          <h2 style="color:#ef4444;">Invalid verification link</h2>
          <p>The link is missing required parameters.</p>
        </body></html>`);
    }

    if (!supabaseServiceRole) {
      return res.status(500).send(`
        <html><body style="font-family:Arial;text-align:center;padding:40px">
          <h2 style="color:#ef4444;">Server error</h2>
          <p>Verification service unavailable.</p>
        </body></html>`);
    }

    const { data: userData, error: userError } = await supabaseServiceRole.auth.admin.getUserById(uid);

    if (userError || !userData?.user) {
      return res.status(404).send(`
        <html><body style="font-family:Arial;text-align:center;padding:40px">
          <h2 style="color:#ef4444;">User not found</h2>
          <p>This account does not exist or has been removed.</p>
        </body></html>`);
    }

    const storedToken = userData.user.user_metadata?.verification_token;
    if (!storedToken || storedToken !== token) {
      return res.status(400).send(`
        <html><body style="font-family:Arial;text-align:center;padding:40px">
          <h2 style="color:#ef4444;">Invalid or expired token</h2>
          <p>Please try registering again.</p>
        </body></html>`);
    }

    await supabaseServiceRole.auth.admin.updateUserById(uid, {
      email_confirm: true,
      user_metadata: { ...userData.user.user_metadata, verification_token: null },
    });

    res.send(`
      <html>
      <head><meta http-equiv="refresh" content="5;url=${process.env.SERVER_URL || "http://localhost:3000"}/login.html"></head>
      <body style="font-family:Arial;text-align:center;padding:40px">
        <h2 style="color:#22c55e;">Email Verified! ✅</h2>
        <p>Your account has been activated. You will be redirected to login in 5 seconds.</p>
        <p><a href="${process.env.SERVER_URL || "http://localhost:3000"}/login.html" style="color:#1e3a5f;">Click here to login now</a></p>
      </body></html>`);
  } catch (err) {
    console.error("[VERIFY EMAIL] Error:", err);
    res.status(500).send(`
      <html><body style="font-family:Arial;text-align:center;padding:40px">
        <h2 style="color:#ef4444;">Verification failed</h2>
        <p>${escHtml(err.message)}</p>
      </body></html>`);
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    if (!supabaseServiceRole) {
      return res.status(500).json({ error: "Verification service unavailable." });
    }

    const { data: users } = await supabaseServiceRole.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email === email);

    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.email_confirmed_at) return res.status(400).json({ error: "Email already confirmed." });

    const token = user.user_metadata?.verification_token;
    if (!token) return res.status(400).json({ error: "No verification token found. Please register again." });

    const verifyLink = `${process.env.SERVER_URL || "http://localhost:3000"}/api/auth/verify-email?token=${token}&uid=${user.id}`;
    const name = user.user_metadata?.name || email.split("@")[0];

    await sendEmail({
      to: email,
      subject: "Confirm Your Email — Infinity Boat Works",
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
          <h2 style="color:#1e3a5f;">Verify Your Email Address 🚢</h2>
          <p>Hi <strong>${escHtml(name)}</strong>,</p>
          <p>Click the button below to confirm your email and activate your account.</p>
          <p style="margin:24px 0;text-align:center">
            <a href="${verifyLink}" style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-size:16px">Confirm Email</a>
          </p>
          <p style="color:#888;font-size:12px;margin-top:20px">Infinity Boat Works · Smart Digital Boat System</p>
        </div>`
    });

    res.json({ success: true, message: "Verification email sent." });
  } catch (err) {
    console.error("[RESEND VERIFY] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============ WORKER REGISTRATION & APPROVAL ============ */

app.post("/api/auth/register-worker", async (req, res) => {
  try {
    const { email, password, fullname, phone, specialty } = req.body;

    if (!email || !password || !fullname || !specialty) {
      return res.status(400).json({ error: "Missing required fields: email, password, fullname, specialty" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (!supabaseServiceRole) {
      return res.status(500).json({ error: "Server not configured for registration." });
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");

    const { data: userData, error: userError } = await supabaseServiceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullname, role: "worker", specialty, verification_token: verificationToken },
    });

    if (userError) {
      if (userError.message?.includes("already registered") || userError.message?.includes("already exists")) {
        return res.status(409).json({ error: "Email already registered." });
      }
      return res.status(500).json({ error: userError.message });
    }

    const { error: profileError } = await supabaseServiceRole.from("profiles").upsert({
      id: userData.user.id,
      email,
      name: fullname,
      phone: phone || "",
      role: "worker",
    }, { onConflict: "id" });

    if (profileError) {
      console.error("[REGISTER WORKER] Profile upsert failed:", profileError);
    }

    const { error: regError } = await supabaseServiceRole.from("worker_registrations").insert({
      userId: userData.user.id,
      email,
      name: fullname,
      phone: phone || "",
      specialty,
      status: "pending",
    });

    if (regError) {
      console.error("[REGISTER WORKER] Registration record failed:", regError);
    }

    sendEmail({
      to: ADMIN_EMAIL,
      subject: `New Worker Registration — ${fullname}`,
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
          <h2 style="color:#1e3a5f;">New Worker Registration 🛠️</h2>
          <p>A new worker has registered and is awaiting your approval.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Name</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(fullname)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Email</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(email)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phone</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(phone || "—")}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Specialty</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(specialty)}</td></tr>
          </table>
          <p>Please review this registration in the admin dashboard.</p>
          <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
        </div>`
    }).catch(err => console.error("[REGISTER WORKER] Admin notification email failed:", err));

    res.status(201).json({ success: true, message: "Registration successful! Your account is pending admin approval. You will receive an email once approved." });
  } catch (err) {
    console.error("[REGISTER WORKER] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/worker-registrations", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("worker_registrations").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/worker-registrations/:id/approve", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: reg, error: fetchErr } = await adminDb
      .from("worker_registrations")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.status !== "pending") return res.status(400).json({ error: "Registration already processed" });

    const { error: updateErr } = await adminDb
      .from("worker_registrations")
      .update({ status: "approved", reviewedBy: req.user.id, reviewedAt: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    try {
      const { data: existingWorker } = await adminDb
        .from("workers")
        .select("id")
        .eq("name", reg.name)
        .maybeSingle();
      if (existingWorker) {
        await adminDb.from("workers").update({ specialty: reg.specialty, status: "Active", userId: reg.userId }).eq("id", existingWorker.id);
      } else {
        const { error: insertWorkerErr } = await adminDb.from("workers").insert({
          name: reg.name,
          specialty: reg.specialty,
          status: "Active",
          userId: reg.userId,
        });
        if (insertWorkerErr) {
          console.error("[APPROVE WORKER] Worker registry insert failed:", insertWorkerErr);
          return res.status(500).json({ error: "Worker approved but failed to add to worker registry: " + insertWorkerErr.message });
        }
      }
    } catch (workerSyncErr) {
      console.error("[APPROVE WORKER] Worker registry sync failed:", workerSyncErr);
      return res.status(500).json({ error: "Worker registry sync failed: " + workerSyncErr.message });
    }

    await adminDb.from("notifications").insert({
      userId: reg.userId,
      title: "Registration Approved",
      message: `Your worker registration has been approved! You can now access your dashboard.`,
      type: "approval",
    });

    sendEmail({
      to: reg.email,
      subject: `Registration Approved — Infinity Boat Works`,
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
          <h2 style="color:#22c55e;">Registration Approved! ✅</h2>
          <p>Hi <strong>${escHtml(reg.name)}</strong>,</p>
          <p>Your worker registration has been approved. You can now log in and access your worker dashboard.</p>
          <p style="margin:24px 0;text-align:center">
            <a href="${process.env.SERVER_URL || "http://localhost:3000"}/login.html"
               style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-size:16px">
              Login Now
            </a>
          </p>
          <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
        </div>`
    }).catch(err => console.error("[APPROVE WORKER] Email failed:", err));

    res.json({ success: true, message: "Worker registration approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/worker-registrations/:id/reject", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const { data: reg, error: fetchErr } = await adminDb
      .from("worker_registrations")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.status !== "pending") return res.status(400).json({ error: "Registration already processed" });

    const { error: updateErr } = await adminDb
      .from("worker_registrations")
      .update({ status: "rejected", reviewedBy: req.user.id, reviewedAt: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    await adminDb.from("notifications").insert({
      userId: reg.userId,
      title: "Registration Rejected",
      message: reason ? `Your worker registration was rejected. Reason: ${reason}` : "Your worker registration was rejected. Please contact admin for details.",
      type: "rejection",
    });

    res.json({ success: true, message: "Worker registration rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/create-worker", authenticate, requireAdmin, async (req, res) => {
  try {
    const { email, password, fullname, phone, specialty } = req.body;

    if (!email || !password || !fullname || !specialty) {
      return res.status(400).json({ error: "Missing required fields: email, password, fullname, specialty" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (!supabaseServiceRole) {
      return res.status(500).json({ error: "Server not configured." });
    }

    const { data: userData, error: userError } = await supabaseServiceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullname, role: "worker", specialty },
    });

    if (userError) {
      if (userError.message?.includes("already registered") || userError.message?.includes("already exists")) {
        return res.status(409).json({ error: "Email already registered." });
      }
      return res.status(500).json({ error: userError.message });
    }

    const { error: profileError } = await supabaseServiceRole.from("profiles").upsert({
      id: userData.user.id,
      email,
      name: fullname,
      phone: phone || "",
      role: "worker",
    }, { onConflict: "id" });

    if (profileError) {
      console.error("[CREATE WORKER] Profile upsert failed:", profileError);
    }

    try {
      const { data: existingWorker } = await adminDb
        .from("workers")
        .select("id")
        .eq("name", fullname)
        .maybeSingle();
      if (existingWorker) {
        const { error: updateWorkerErr } = await adminDb
          .from("workers")
          .update({ specialty, status: "Active", userId: userData.user.id })
          .eq("id", existingWorker.id);
        if (updateWorkerErr) console.error("[CREATE WORKER] Worker registry update failed:", updateWorkerErr);
      } else {
        const { error: workerErr } = await adminDb.from("workers").insert({
          name: fullname,
          specialty,
          status: "Active",
          userId: userData.user.id,
        }).select();
        if (workerErr) {
          console.error("[CREATE WORKER] Worker registry insert failed:", workerErr);
          return res.status(500).json({ error: "Account created but failed to add worker to registry: " + workerErr.message });
        }
      }
    } catch (workerSyncErr) {
      console.error("[CREATE WORKER] Worker registry sync failed:", workerSyncErr);
      return res.status(500).json({ error: "Worker registry sync failed: " + workerSyncErr.message });
    }

    await adminDb.from("notifications").insert({
      userId: userData.user.id,
      title: "Account Created",
      message: `Your worker account has been created by admin. You can now log in and access your dashboard.`,
      type: "approval",
    });

    sendEmail({
      to: email,
      subject: `Your Worker Account is Ready — Infinity Boat Works`,
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
          <h2 style="color:#1e3a5f;">Your Account is Ready! 🛠️</h2>
          <p>Hi <strong>${escHtml(fullname)}</strong>,</p>
          <p>An admin has created your worker account. You can now log in with the following credentials:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Email</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(email)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Password</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(password)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Specialty</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(specialty)}</td></tr>
          </table>
          <p style="color:#c0392b;font-size:13px"><strong>Important:</strong> Please change your password after your first login for security.</p>
          <p style="margin:24px 0;text-align:center">
            <a href="${process.env.SERVER_URL || "http://localhost:3000"}/login.html"
               style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-size:16px">
              Login Now
            </a>
          </p>
          <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
        </div>`
    }).catch(err => console.error("[CREATE WORKER] Welcome email failed:", err));

    res.status(201).json({ success: true, message: "Worker account created successfully" });
  } catch (err) {
    console.error("[CREATE WORKER] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/worker-status", authenticate, async (req, res) => {
  try {
    const { data: reg, error } = await adminDb
      .from("worker_registrations")
      .select("status")
      .eq("userId", req.user.id)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: reg?.status || "approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ NOTIFICATIONS ============ */

app.get("/api/notifications", authenticate, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("notifications")
      .select("*")
      .eq("userId", req.user.id)
      .order("createdAt", { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/notifications/:id/read", authenticate, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("notifications")
      .update({ read: true })
      .eq("id", req.params.id)
      .eq("userId", req.user.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notifications/read-all", authenticate, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("notifications")
      .update({ read: true })
      .eq("userId", req.user.id)
      .eq("read", false)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, count: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notifications", authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId, title, message, type, orderId } = req.body;
    if (!userId || !title || !message) {
      return res.status(400).json({ error: "Missing required fields: userId, title, message" });
    }

    const { data, error } = await adminDb
      .from("notifications")
      .insert({ userId, title, message, type: type || "general", orderId: orderId || null })
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ WORKER-SPECIFIC ============ */

app.get("/api/worker/my-assignments", authenticate, async (req, res) => {
  try {
    let workerName = null;

    const { data: worker, error: wErr } = await adminDb
      .from("workers")
      .select("*")
      .eq("userId", req.user.id)
      .maybeSingle();

    // Fallback: if the logged-in user has no linked "workers" row, try to match
    // their profile name against assignments directly. This covers seeded workers
    // whose accounts were created after assignments were made (userId null).
    if (wErr || !worker) {
      const { data: profile } = await adminDb
        .from("profiles")
        .select("id, name")
        .eq("id", req.user.id)
        .maybeSingle();
      workerName = profile?.name || null;
    } else {
      workerName = worker.name;
    }

    if (!workerName) return res.json([]);

    const { data, error } = await adminDb
      .from("project_workers")
      .select("*, boat_orders(boatName, boatImage, boatPrice, status, progress, orderPhase)")
      .eq("name", workerName)
      .order("createdAt", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/worker/update-task/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const { data: assignment, error: fetchErr } = await adminDb
      .from("project_workers")
      .select("*, workers(userId)")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !assignment) return res.status(404).json({ error: "Assignment not found" });

    // Authorize via linked worker account OR by matching the profile name.
    // The name fallback covers seeded workers whose "workers" row isn't linked.
    const workerUserId = assignment.workers?.userId;
    let isOwner = workerUserId === req.user.id;
    if (!isOwner) {
      const { data: profile } = await adminDb
        .from("profiles")
        .select("name")
        .eq("id", req.user.id)
        .maybeSingle();
      isOwner = !!profile && profile.name === assignment.name;
    }
    if (!isOwner) {
      return res.status(403).json({ error: "Not authorized to update this task" });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (status) {
      updates.status = status;
      if (status === "Completed") updates.completedAt = new Date().toISOString();
    }
    if (typeof notes === "string") {
      updates.notes = notes;
    }

    let { data, error } = await adminDb
      .from("project_workers")
      .update(updates)
      .eq("id", id)
      .select();

    // Graceful fallback: if the "notes" column isn't migrated yet, drop it from
    // the payload and retry so the status update still succeeds.
    if (error && updates.notes !== undefined) {
      const { notes, ...withoutNotes } = updates;
      const retry = await adminDb
        .from("project_workers")
        .update(withoutNotes)
        .eq("id", id)
        .select();
      if (retry.error) return res.status(500).json({ error: retry.error.message });
      data = retry.data;
      error = null;
    }

    if (error) return res.status(500).json({ error: error.message });

    if (status === "Completed") {
      const { data: order } = await adminDb
        .from("boat_orders")
        .select("userId, boatName")
        .eq("orderId", assignment.orderId)
        .maybeSingle();

      const { data: admins } = await adminDb
        .from("profiles")
        .select("id")
        .eq("role", "admin");

      const adminIds = (admins || []).map(a => a.id);
      const boatName = order?.boatName || assignment.orderId;
      if (adminIds.length > 0) {
        const notifications = adminIds.map(uid => ({
          userId: uid,
          title: "Phase Completed — Pending Approval",
          message: `Worker ${assignment.name} has completed the ${assignment.phase} phase for ${boatName}. Please review and approve it.`,
          type: "task_update",
          orderId: assignment.orderId,
        }));
        await adminDb.from("notifications").insert(notifications);
      }
    }

    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/worker/approve-phase", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { orderId, phaseKey } = req.body || {};
    if (!orderId || !phaseKey) return res.status(400).json({ error: "orderId and phaseKey are required" });

    const boatData = await import("./boatData.js");

    const { data: order, error: orderErr } = await adminDb
      .from("boat_orders")
      .select("*")
      .eq("orderId", orderId)
      .maybeSingle();
    if (orderErr) return res.status(500).json({ error: orderErr.message });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === "Completed" || order.status === "Cancelled") {
      return res.status(400).json({ error: "Order is no longer active" });
    }

    let milestones = Array.isArray(order.milestones) ? order.milestones : [];
    const presets = boatData.getBoatMilestones ? (boatData.getBoatMilestones(order.boatName) || []) : [];
    if (milestones.length === 0) {
      milestones = presets.map(p => ({
        label: p.label,
        percentage: p.percentage,
        key: p.key,
        completed: Number(order.progress || 0) >= p.percentage,
        completedDate: Number(order.progress || 0) >= p.percentage ? new Date().toISOString() : null,
        history: []
      }));
    } else {
      milestones = milestones.map((m, i) => {
        if (m.key) return m;
        const preset = presets[i] || presets.find(p => p.percentage === m.percentage);
        return { ...m, key: preset ? preset.key : "" };
      });
    }

    const target = milestones.find(m => m.key === phaseKey);
    if (!target) return res.status(404).json({ error: "Phase not found in this order" });
    if (target.completed) return res.status(400).json({ error: "This phase is already approved" });

    const prev = milestones.filter(m => m.percentage < target.percentage);
    if (!prev.every(m => m.completed)) {
      return res.status(400).json({ error: "Previous phases must be approved first" });
    }

    const paymentGate = { 0: 0, 1: 40, 2: 75, 3: 100 };
    const maxProgress = paymentGate[order.paymentStep || 0] || 0;
    if (target.percentage > maxProgress) {
      const needed = maxProgress === 0 ? "Downpayment" : maxProgress === 40 ? "Mid-Construction Payment" : "Final Payment";
      return res.status(400).json({ error: "Required payment not completed yet. Complete " + needed + " first." });
    }
    if (target.percentage === 100 && Number(order.remainingBalance || 0) > 0) {
      return res.status(400).json({ error: "Order must be fully paid before completion." });
    }

    // Mark this phase approved
    const now = new Date().toISOString();
    target.completed = true;
    target.completedDate = now;

    let status = order.status;
    let orderPhase = order.orderPhase;
    let projectCompletedDate = order.projectCompletedDate || null;
    if (target.percentage === 100) {
      status = "Completed";
      orderPhase = "Completed";
      projectCompletedDate = now;
    } else if (target.percentage >= 70) {
      orderPhase = "Painting & Finishing";
    } else if (target.percentage >= 45) {
      orderPhase = "Interior Installation";
    } else if (target.percentage >= 25) {
      orderPhase = "Engine Assembly";
    } else {
      orderPhase = target.label;
    }

    // Append a system activity-log entry
    const activity = Array.isArray(order.activityLog) ? order.activityLog : [];
    const autoDesc = (() => {
      const presetsForBoat = boatData.getBoatActivities ? (boatData.getBoatActivities(order.boatName) || {}) : {};
      const list = presetsForBoat[phaseKey] || [];
      return list.length ? list[0] : (target.label || phaseKey) + " approved.";
    })();
    const actorRole = req.profile?.role || req.user?.user_metadata?.role || "admin";
    const actorName = req.profile?.name || req.user?.user_metadata?.name || (actorRole === "manager" ? "Project Manager" : "Admin");
    activity.push({
      title: target.label,
      description: autoDesc,
      date: now,
      personnel: actorName,
      role: "Approved"
    });

    const { data: updated, error: updErr } = await adminDb
      .from("boat_orders")
      .update({
        status,
        progress: target.percentage,
        orderPhase,
        milestones,
        projectCompletedDate,
        activityLog: activity
      })
      .eq("orderId", orderId)
      .select();
    if (updErr) return res.status(500).json({ error: updErr.message });

    // Release this phase's workers (they remain recorded as Completed)
    await adminDb
      .from("project_workers")
      .update({ status: "Completed", completedAt: now })
      .eq("orderId", orderId)
      .eq("phase", phaseKey)
      .eq("status", "Active");

    // Notify the customer
    if (order.userId) {
      await adminDb.from("notifications").insert({
        userId: order.userId,
        title: target.percentage === 100 ? "Your boat is ready!" : "Progress Update",
        message: `The ${target.label} phase (${order.boatName || orderId}) has been approved by our team. Current progress: ${target.percentage}%.`,
        type: "progress",
        orderId,
      });
    }

    res.json(updated ? updated[0] : { ...order, status, progress: target.percentage, orderPhase, milestones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ ORDERS ============ */

app.get("/api/orders", authenticate, async (req, res) => {
  try {
    let query = supabase.from("boat_orders").select("*").order("createdAt", { ascending: false });

    if (req.profile?.role !== "admin" && req.user?.user_metadata?.role !== "admin" && req.profile?.role !== "manager" && req.user?.user_metadata?.role !== "manager") {
      query = query.eq("userId", req.user.id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders", authenticate, async (req, res) => {
  try {
    const body = { ...req.body, userId: req.user.id };

    if (!body.orderId || !body.boatName) {
      return res.status(400).json({ error: "Missing required fields: orderId, boatName" });
    }

    const { data, error } = await supabase.from("boat_orders").insert(body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/orders/:orderId", authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;

    const { data: existing } = await supabase
      .from("boat_orders")
      .select("*")
      .eq("orderId", orderId)
      .single();

    if (!existing) return res.status(404).json({ error: "Order not found" });

    if (req.profile?.role !== "admin" && req.user?.user_metadata?.role !== "admin" && req.profile?.role !== "manager" && req.user?.user_metadata?.role !== "manager" && existing.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to update this order" });
    }

    const { data, error } = await supabase
      .from("boat_orders")
      .update({ ...updates, updatedAt: new Date().toISOString() })
      .eq("orderId", orderId)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/orders/:orderId", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb
      .from("boat_orders")
      .delete()
      .eq("orderId", req.params.orderId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ DELIVERY ============ */

function calculateDelayPenalty(boatPrice, delayDays) {
  const cleanPrice = parseInt(String(boatPrice || '0').replace(/[^0-9]/g, '')) || 0;
  let percent = 0;
  if (delayDays >= 1 && delayDays <= 7) percent = 1;
  else if (delayDays >= 8 && delayDays <= 14) percent = 2;
  else if (delayDays >= 15 && delayDays <= 30) percent = 5;
  else if (delayDays > 30) percent = 8;
  const penalty = Math.round(cleanPrice * (percent / 100));
  return { penalty, percent };
}

app.put("/api/orders/:orderId/delivery", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      deliveryStatus, committedDeliveryDate, actualDeliveryDate,
      deliveryLocation, contactPerson, seaTrialResults,
      deliveryProgress, deliveryConfirmed, delayReason, deliveryNotes
    } = req.body;

    const { data: existing, error: fetchErr } = await supabase
      .from("boat_orders")
      .select("*")
      .eq("orderId", orderId)
      .single();

    if (fetchErr || !existing) return res.status(404).json({ error: "Order not found" });

    const oldInfo = existing.deliveryInfo || {};
    const newInfo = { ...oldInfo };

    if (deliveryStatus !== undefined) newInfo.deliveryStatus = deliveryStatus;
    if (committedDeliveryDate !== undefined) newInfo.committedDeliveryDate = committedDeliveryDate;
    if (actualDeliveryDate !== undefined) newInfo.actualDeliveryDate = actualDeliveryDate;
    if (deliveryLocation !== undefined) newInfo.deliveryLocation = deliveryLocation;
    if (contactPerson !== undefined) newInfo.contactPerson = contactPerson;
    if (seaTrialResults !== undefined) newInfo.seaTrialResults = seaTrialResults;
    if (deliveryProgress !== undefined) newInfo.deliveryProgress = Number(deliveryProgress) || 0;
    if (deliveryConfirmed !== undefined) newInfo.deliveryConfirmed = deliveryConfirmed;
    if (delayReason !== undefined) newInfo.delayReason = delayReason;
    if (deliveryNotes !== undefined) newInfo.deliveryNotes = deliveryNotes;

    // Auto-calculate delay penalty
    if (actualDeliveryDate && committedDeliveryDate) {
      const actual = new Date(actualDeliveryDate);
      const committed = new Date(committedDeliveryDate);
      if (actual > committed) {
        const diffMs = actual - committed;
        const delayDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const { penalty, percent } = calculateDelayPenalty(existing.boatPrice, delayDays);
        newInfo.delayDays = delayDays;
        newInfo.delayPenalty = penalty;
        newInfo.delayPenaltyPercent = percent;
      } else {
        newInfo.delayDays = 0;
        newInfo.delayPenalty = 0;
        newInfo.delayPenaltyPercent = 0;
      }
    }

    if (deliveryStatus === "Delivered") {
      newInfo.deliveryConfirmed = true;
      newInfo.deliveryProgress = 100;
    }

    const { data, error } = await adminDb
      .from("boat_orders")
      .update({ deliveryInfo: newInfo, updatedAt: new Date().toISOString() })
      .eq("orderId", orderId)
      .select();

    if (error) return res.status(500).json({ error: error.message });

    // Send delay notification email if delay detected and not yet notified
    if (newInfo.delayDays > 0 && !oldInfo.delayNotified && newInfo.actualDeliveryDate) {
      try {
        sendEmail({
          to: existing.customerEmail,
          subject: `Delivery Update — ${orderId} (Delay Notice)`,
          html: DELAY_NOTICE_TEMPLATE({
            ...existing,
            delayDays: newInfo.delayDays,
            delayPenalty: newInfo.delayPenalty,
            delayPenaltyPercent: newInfo.delayPenaltyPercent,
            delayReason: newInfo.delayReason || "Unspecified",
            committedDeliveryDate: newInfo.committedDeliveryDate,
            actualDeliveryDate: newInfo.actualDeliveryDate
          })
        });
        newInfo.delayNotified = true;
        await adminDb
          .from("boat_orders")
          .update({ deliveryInfo: newInfo })
          .eq("orderId", orderId);
      } catch (emailErr) {
        console.error("[DELIVERY] Delay email failed:", emailErr);
      }
    }

    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ PAYMENTS ============ */

app.get("/api/payments", authenticate, async (req, res) => {
  try {
    let query = supabase.from("dashboard_payments").select("*").order("createdAt", { ascending: false });

    if (req.profile?.role !== "admin" && req.user?.user_metadata?.role !== "admin") {
      query = query.eq("userId", req.user.id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/payments", authenticate, async (req, res) => {
  try {
    const body = { ...req.body, userId: req.user.id };

    if (!body.orderId || !body.amount) {
      return res.status(400).json({ error: "Missing required fields: orderId, amount" });
    }

    const { data: order } = await supabase
      .from("boat_orders")
      .select("orderId")
      .eq("orderId", body.orderId)
      .single();

    if (!order) {
      return res.status(400).json({ error: "Order not found. Cannot submit payment for a non-existent order." });
    }

    const { data, error } = await supabase.from("dashboard_payments").insert(body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/payments/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("dashboard_payments")
      .update({ ...req.body, updatedAt: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ PROFILES ============ */

app.get("/api/profiles", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/profiles/:id", authenticate, async (req, res) => {
  try {
    if (req.profile?.role !== "admin" && req.user?.user_metadata?.role !== "admin" && req.params.id !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/users/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: profile } = await adminDb
      .from("profiles")
      .select("role, email")
      .eq("id", id)
      .single();

    if (profile?.role === "admin") {
      return res.status(403).json({ error: "Cannot delete admin accounts" });
    }

    if (!supabaseServiceRole) {
      return res.status(500).json({ error: "Server not configured for user deletion." });
    }

    const { error } = await supabaseServiceRole.auth.admin.deleteUser(id);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, message: "User and all associated data deleted permanently." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ INVENTORY ============ */

app.get("/api/inventory", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("inventory").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/inventory", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("inventory").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/inventory/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("inventory")
      .update({ ...req.body, updatedAt: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/inventory/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb.from("inventory").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ WORKERS ============ */

app.get("/api/workers", authenticate, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("project_workers").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Master worker registry (must be defined BEFORE /api/workers/:orderId so it
// is not shadowed by the parameterized route)
app.get("/api/workers/master", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data: workers, error } = await adminDb.from("workers").select("*").order("name", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const { data: activeAssignments, error: assignErr } = await adminDb
      .from("project_workers")
      .select("name, orderId, phase, status")
      .eq("status", "Active");
    if (assignErr) return res.status(500).json({ error: assignErr.message });

    const busy = new Map();
    (activeAssignments || []).forEach(a => {
      if (!busy.has(a.name)) busy.set(a.name, { orderId: a.orderId, phase: a.phase });
    });

    const result = (workers || []).map(w => {
      const current = busy.get(w.name);
      return {
        ...w,
        available: !current,
        currentOrderId: current ? current.orderId : null,
        currentPhase: current ? current.phase : null
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/workers/:orderId", authenticate, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("project_workers")
      .select("*")
      .eq("orderId", req.params.orderId)
      .order("createdAt", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    let payload = Array.isArray(req.body) ? req.body : [req.body];
    if (payload.some(w => w.orderId && w.phase)) {
      try {
        const boatData = await import("./boatData.js");
        const orderId = payload[0].orderId;
        const { data: order } = await adminDb
          .from("boat_orders")
          .select("boatName, createdAt")
          .eq("orderId", orderId)
          .maybeSingle();
        if (order && order.createdAt) {
          payload = payload.map(w => {
            const range = w.phase ? boatData.getPhaseDateRange(order.boatName, w.phase, order.createdAt) : null;
            return {
              ...w,
              startDate: range?.startDate || w.startDate || null,
              endDate: range?.endDate || w.endDate || null
            };
          });
        }
      } catch (e) {
        // fall through and insert without computed deadlines
      }
    }

    // Single-project rule: a worker may not be Active on a different order.
    const incomingOrderIds = new Set(payload.map(w => w.orderId).filter(Boolean));
    let orderLabels = {};
    try {
      const { data: boatOrders } = await adminDb
        .from("boat_orders")
        .select("orderId, boatName")
        .in("orderId", [...incomingOrderIds]);
      (boatOrders || []).forEach(o => { orderLabels[o.orderId] = o.boatName || o.orderId; });
    } catch (e) { /* labels are best-effort */ }

    const { data: activeOthers } = await adminDb
      .from("project_workers")
      .select("name, orderId")
      .eq("status", "Active");
    const busyOnOrder = {};
    (activeOthers || []).forEach(a => { busyOnOrder[a.name] = a.orderId; });

    const conflict = payload.find(w => {
      const busyOrderId = busyOnOrder[w.name];
      return busyOrderId && busyOrderId !== w.orderId;
    });
    if (conflict) {
      const busyBoat = orderLabels[busyOnOrder[conflict.name]] || busyOnOrder[conflict.name];
      return res.status(400).json({
        error: `${conflict.name} is already assigned (Active) to another project (${busyBoat}). Release or complete that phase before assigning them here.`
      });
    }

    const { data, error } = await adminDb.from("project_workers").insert(payload).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(Array.isArray(req.body) ? data : data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers/seed", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data: existing } = await adminDb.from("workers").select("name").limit(1);
    if (existing && existing.length > 0) return res.json({ seeded: false, reason: "already seeded" });
    const { data, error } = await adminDb.from("workers").insert(req.body.workers).select();
    if (error) {
      console.error("[SEED] Insert error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    console.log("[SEED] Seeded", data.length, "workers");
    res.status(201).json({ seeded: true, count: data.length });
  } catch (err) {
    console.error("[SEED] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Backfill: sync worker registrations (approved and pending) into the workers table
app.post("/api/workers/backfill", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data: registrations, error: regErr } = await adminDb
      .from("worker_registrations")
      .select("userId, name, specialty, status")
      .in("status", ["approved", "pending"]);
    if (regErr) return res.status(500).json({ error: regErr.message });

    const { data: existingWorkers } = await adminDb.from("workers").select("name, userId");
    const knownNames = new Set((existingWorkers || []).map(w => w.name));

    let added = 0;
    let skipped = 0;
    for (const reg of (registrations || [])) {
      if (!reg.name || knownNames.has(reg.name)) { skipped++; continue; }
      const { error: insertErr } = await adminDb.from("workers").insert({
        name: reg.name,
        specialty: reg.specialty || "Builder",
        status: "Active",
        userId: reg.userId || null,
      });
      if (insertErr) {
        console.error("[BACKFILL] Insert failed for", reg.name, insertErr.message);
        continue;
      }
      added++;
      knownNames.add(reg.name);
    }

    res.json({ success: true, added, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign a stable, complete build team: one available worker per required
// specialty, covering every phase of the boat build (start -> end).
// Idempotent: workers already Active on this order are not re-assigned.
async function assignFullTeam(orderId) {
  const { data: order } = await adminDb
    .from("boat_orders")
    .select("userId, customerEmail, boatName, createdAt")
    .eq("orderId", orderId)
    .single();
  if (!order) return { error: "Order not found", status: 404 };

  const boatData = await import("./boatData.js");
  const SPECIALTY_PHASES = boatData.SPECIALTY_PHASES || {};
  const phaseDateRange = (phase) =>
    order.createdAt
      ? boatData.getPhaseDateRange(order.boatName, phase, order.createdAt)
      : null;

  // Phase keys in build order (start -> end).
  const milestones = boatData.getBoatMilestones?.(order.boatName) || [];
  const phases = [...new Set(milestones.map(m => m.key).filter(Boolean))];
  if (phases.length === 0) return { error: "No build phases defined", status: 400 };

  // Union of specialties required across all phases.
  const specialties = [];
  phases.forEach(phase => {
    const needed = boatData.getPhaseSpecialties?.(phase) || [];
    needed.forEach(s => { if (!specialties.includes(s)) specialties.push(s); });
  });

  // Existing Active worker rows for this order -> idempotency guard + continuity.
  const { data: existing } = await adminDb
    .from("project_workers")
    .select("name, phase, status")
    .eq("orderId", orderId);
  const activeNames = new Set(
    (existing || []).filter(w => w.status === "Active").map(w => w.name)
  );
  const activePhaseKeys = new Set(
    (existing || []).filter(w => w.status === "Active" && w.phase).map(w => w.name + "||" + w.phase)
  );

  // Workers Active on OTHER orders are busy (single-project rule).
  const { data: activeOnOthers } = await adminDb
    .from("project_workers")
    .select("name")
    .eq("status", "Active")
    .neq("orderId", orderId);
  const busy = new Set((activeOnOthers || []).map(w => w.name));

  const { data: allWorkers } = await adminDb.from("workers").select("*");
  if (!allWorkers || allWorkers.length === 0) return { error: "No workers in registry", status: 400 };

  const teamMembers = [];
  const skipped = [];
  specialties.forEach(spec => {
    const candidates = allWorkers.filter(w =>
      String(w.specialty || "").toLowerCase() === String(spec).toLowerCase()
    );
    // Prefer a worker already Active on this order (stays the whole build),
    // otherwise the first available worker not busy elsewhere.
    const pick = candidates.find(w => activeNames.has(w.name))
      || candidates.find(w => !busy.has(w.name) && !activeNames.has(w.name));
    if (pick) {
      activeNames.add(pick.name);
      teamMembers.push({ ...pick, specialty: spec });
    } else {
      skipped.push({ specialty: spec, reason: "no available worker" });
    }
  });

  const phaseSet = new Set(phases);
  const assignments = [];
  teamMembers.forEach(m => {
    const phaseKey = Object.keys(SPECIALTY_PHASES).find(
      s => String(s).toLowerCase() === String(m.specialty).toLowerCase()
    ) || m.specialty;
    const memberPhases = (SPECIALTY_PHASES[phaseKey] || []).filter(p => phaseSet.has(p));
    memberPhases.forEach(phase => {
      if (activePhaseKeys.has(m.name + "||" + phase)) return;
      const range = phaseDateRange(phase);
      assignments.push({
        orderId,
        name: m.name,
        role: m.specialty,
        specialty: m.specialty,
        phase,
        status: "Active",
        startDate: range?.startDate || null,
        endDate: range?.endDate || null
      });
    });
  });

  let inserted = [];
  if (assignments.length > 0) {
    const { data, error } = await adminDb.from("project_workers").insert(assignments).select();
    if (error) return { error: error.message, status: 500 };
    inserted = data;

    for (const assignment of inserted) {
      const { data: worker } = await adminDb
        .from("workers")
        .select("userId, name")
        .eq("name", assignment.name)
        .maybeSingle();

      if (worker?.userId) {
        await adminDb.from("notifications").insert({
          userId: worker.userId,
          title: "New Assignment",
          message: `You have been assigned to project ${orderId}${order.boatName ? " (" + order.boatName + ")" : ""} — Phase: ${assignment.phase}`,
          type: "assignment",
          orderId,
        });
      }
    }
  }
  return { assigned: true, count: inserted.length, team: teamMembers.map(m => m.name), phases, skipped };
}

app.post("/api/workers/assign-team/:orderId", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const result = await assignFullTeam(orderId);
    if (result.status) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers/release-phase/:orderId", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { phase } = req.body || {};
    if (!phase) return res.status(400).json({ error: "phase is required" });

    const { data, error } = await adminDb
      .from("project_workers")
      .update({ status: "Completed", completedAt: new Date().toISOString() })
      .eq("orderId", orderId)
      .eq("phase", phase)
      .eq("status", "Active")
      .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ released: true, count: data.length, phase });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/workers/:id", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { error } = await adminDb.from("project_workers").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers/master", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("workers").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/workers/master/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb.from("workers").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/workers-detail", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data: workers, error } = await adminDb
      .from("workers")
      .select("*")
      .order("name", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const userIds = (workers || []).filter(w => w.userId).map(w => w.userId);
    let profilesMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await adminDb
        .from("profiles")
        .select("id, email, name, phone, role")
        .in("id", userIds);
      (profiles || []).forEach(p => { profilesMap[p.id] = p; });
    }

    const { data: activeAssignments } = await adminDb
      .from("project_workers")
      .select("name, orderId, phase, status")
      .eq("status", "Active");

    const busy = new Map();
    (activeAssignments || []).forEach(a => {
      if (!busy.has(a.name)) busy.set(a.name, { orderId: a.orderId, phase: a.phase });
    });

    const { data: regData } = await adminDb
      .from("worker_registrations")
      .select("userId, status")
      .order("createdAt", { ascending: false });

    const regMap = {};
    (regData || []).forEach(r => {
      if (!regMap[r.userId]) regMap[r.userId] = r.status;
    });

    const result = (workers || []).map(w => {
      const profile = profilesMap[w.userId] || {};
      const current = busy.get(w.name);
      return {
        id: w.id,
        name: w.name,
        specialty: w.specialty,
        status: w.status,
        userId: w.userId,
        email: profile.email || "",
        phone: profile.phone || "",
        hasAccount: !!w.userId,
        accountRole: profile.role || "",
        regStatus: w.userId ? (regMap[w.userId] || "approved") : null,
        available: !current,
        currentOrderId: current ? current.orderId : null,
        currentPhase: current ? current.phase : null,
        createdAt: w.createdAt,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ TASKS ============ */

app.get("/api/tasks", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from("project_tasks").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("project_tasks").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("project_tasks")
      .update({ ...req.body, updatedAt: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { error } = await adminDb.from("project_tasks").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ DOCUMENT UPLOAD ============ */

app.post("/api/upload", authenticate, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const fileUrl = "/uploads/" + req.file.filename;
    res.json({ url: fileUrl, filename: req.file.originalname, size: req.file.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ REPORTS ============ */

app.get("/api/reports/summary", authenticate, requireAdminOrManager, async (req, res) => {
  try {
    const { data: orders, error } = await adminDb.from("boat_orders").select("*");
    if (error) return res.status(500).json({ error: error.message });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((s, o) => s + (parseInt(String(o.boatPrice || '0').replace(/[^0-9]/g, '')) || 0), 0);
    const completed = orders.filter(o => o.status === 'Completed').length;
    const pending = orders.filter(o => o.status === 'Pending' || o.status === 'Pending Signing').length;
    const active = orders.filter(o => o.status === 'Approved').length;

    const boatCount = {};
    orders.forEach(o => {
      const name = o.boatName || 'Unknown';
      boatCount[name] = (boatCount[name] || 0) + 1;
    });

    res.json({
      totalOrders,
      totalRevenue,
      completed,
      pending,
      active,
      topBoats: Object.entries(boatCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ EMAIL UTILITY ============ */

const EMAIL_FROM = `"Infinity Boat Works" <${process.env.EMAIL_USER || "infiboatworks@gmail.com"}>`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "infinityboatsystem@gmail.com";

const EMAIL_TEMPLATES = {
  order_created: (data) => ({
    subject: `Order Confirmed — ${data.orderId}`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Order Confirmed 🚢</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Thank you for placing your order with Infinity Boat Works! Your order has been received and is now being processed.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat Model</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Price</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatPrice || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Payment</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.paymentMethod || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Status</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.status || "Pending")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Date</strong></td><td style="padding:8px;border:1px solid #ddd">${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</td></tr>
        </table>
        <p><strong>Next Step:</strong> ${data.buildType === "custom" ? "Our engineering team will review your custom design. We'll notify you once it's approved." : "Please check your account to sign the contract schedule and proceed with the down payment."}</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  status_changed: (data) => ({
    subject: `Order Update — ${data.orderId} (${data.status})`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Order Status Update 🔔</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Your order status has been updated:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat Model</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>New Status</strong></td><td style="padding:8px;border:1px solid #ddd"><span style="color:${getStatusColor(data.status)};font-weight:bold">${escHtml(data.status)}</span></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phase</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderPhase || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Progress</strong></td><td style="padding:8px;border:1px solid #ddd">${data.progress || 0}%</td></tr>
        </table>
        ${data.reviewFeedback ? `<p><strong>Feedback:</strong> ${escHtml(data.reviewFeedback)}</p>` : ""}
        <p>Log in to your account to view the full details.</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  payment_submitted: (data) => ({
    subject: `New Payment — ${data.customerName || "Customer"} (${data.amount})`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">New Payment Submitted 💳</h2>
        <p>A payment has been submitted and is pending review.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Customer</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.customerName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #ddd">₱${Number(data.amount || 0).toLocaleString()}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Bank</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.bank || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Reference</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.reference || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phase</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.phase || "—")}</td></tr>
        </table>
        <p>Please review and approve/reject this payment in the dashboard.</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  cancellation_requested: (data) => ({
    subject: `Cancellation Request — ${data.orderId} (${data.customerName || "Customer"})`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#c0392b;">Cancellation Requested 🚫</h2>
        <p>A customer has requested to cancel their order. Please review the details below.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Customer</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.customerName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat Model</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Previous Status</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.previousStatus || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Build Progress</strong></td><td style="padding:8px;border:1px solid #ddd">${data.progress || 0}%</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Cancellation Fee</strong></td><td style="padding:8px;border:1px solid #ddd;color:#c0392b;font-weight:bold">${data.cancelFee ? "₱" + Number(data.cancelFee).toLocaleString() : "No fee"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Reason</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.cancelReason || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Signed by</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.cancelSignature || "—")}</td></tr>
        </table>
        ${data.cancelMaterials && data.cancelMaterials.length > 0 ? `<p><strong>Materials Allocated:</strong></p><ul style="margin:8px 0;padding-left:20px;">${data.cancelMaterials.map(m => '<li style="padding:2px 0;">' + escHtml(m) + '</li>').join('')}</ul>` : ""}
        ${data.cancelFee > 0 ? `<p style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;margin:16px 0;"><strong>⚠️ Action Required:</strong> The customer will be redirected to pay the cancellation fee. You can approve or reject this cancellation from the Orders dashboard.</p>` : `<p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin:16px 0;">This order has been <strong>auto-cancelled</strong> (no cancellation fee applies). No admin action needed.</p>`}
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  payment_approved: (data) => ({
    subject: `Payment Approved — ${data.orderId}`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Payment Approved ✅</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Your payment has been approved!</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #ddd">₱${Number(data.amount || 0).toLocaleString()}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phase</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.phase || "—")}</td></tr>
        </table>
        <p>Thank you for your payment!</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  payment_rejected: (data) => ({
    subject: `Payment Rejected — ${data.orderId}`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Payment Rejected ❌</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Unfortunately, your payment has been rejected.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #ddd">₱${Number(data.amount || 0).toLocaleString()}</td></tr>
        </table>
        <p>Please resubmit your payment with the correct details. Contact us if you need assistance.</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),
};

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStatusColor(status) {
  const colors = { Approved: "#22c55e", Rejected: "#ef4444", Completed: "#3b82f6", "Under Review": "#f59e0b", "Pending Signing": "#f59e0b" };
  return colors[status] || "#6b7280";
}

function DELAY_NOTICE_TEMPLATE(data) {
  return `
    <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
      <h2 style="color:#c0392b;">Delivery Delay Notice</h2>
      <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
      <p>We regret to inform you that your boat delivery has been delayed. We sincerely apologize for the inconvenience.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat Model</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Committed Delivery Date</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.committedDeliveryDate || "—")}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Actual Delivery Date</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.actualDeliveryDate || "—")}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Days Delayed</strong></td><td style="padding:8px;border:1px solid #ddd;color:#c0392b;font-weight:bold">${data.delayDays} day(s)</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Delay Reason</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.delayReason || "—")}</td></tr>
      </table>
      ${data.delayPenalty > 0 ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
        <h3 style="color:#15803d;margin-bottom:8px;">Delay Compensation Applied</h3>
        <p style="font-size:14px;color:#166534;">As compensation for the delay, a discount of <strong>${data.delayPenaltyPercent}% (₱${Number(data.delayPenalty).toLocaleString()})</strong> has been applied to your order. This will be reflected in your final billing.</p>
      </div>` : ''}
      <p style="color:#64748b;font-size:13px;">We value your patience and understanding. If you have any questions, please don't hesitate to contact us.</p>
      <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
    </div>`;
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS === "YOUR_GMAIL_APP_PASSWORD") {
    console.log(`[EMAIL SIMULATED] To: ${to} | Subject: ${subject}`);
    return { simulated: true, to, subject };
  }
  try {
    const info = await emailTransporter.sendMail({ from: EMAIL_FROM, to, subject, html });
    console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject} | ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL FAILED] To: ${to} | Error: ${err.message}`);
    throw err;
  }
}

async function fetchOrderDetails(orderId) {
  if (!supabaseServiceRole) return null;
  const { data } = await supabaseServiceRole
    .from("boat_orders")
    .select("*")
    .eq("orderId", orderId)
    .single();
  return data;
}

async function fetchPaymentDetails(paymentId) {
  if (!supabaseServiceRole) return null;
  const { data } = await supabaseServiceRole
    .from("dashboard_payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  return data;
}

/* ============ SEND EMAIL API ============ */

app.post("/api/send-email", async (req, res) => {
  try {
    const { type, orderId, paymentId, recipient, data } = req.body;
    if (!type || !recipient) {
      return res.status(400).json({ error: "Missing required fields: type, recipient" });
    }

    const template = EMAIL_TEMPLATES[type];
    if (!template) {
      return res.status(400).json({ error: `Unknown email type: ${type}` });
    }

    let emailData = data || {};

    if (orderId) {
      const order = await fetchOrderDetails(orderId);
      if (order) emailData = { ...emailData, ...order };
    }

    if (paymentId) {
      const payment = await fetchPaymentDetails(paymentId);
      if (payment) emailData = { ...emailData, ...payment };
    }

    const { subject, html } = template(emailData);
    const result = await sendEmail({ to: recipient, subject, html });

    res.json(result);
  } catch (err) {
    console.error("[EMAIL API ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============ BOAT DATA (loaded from boatData.js) ============ */

app.get("/api/boat-data/:boatName", async (req, res) => {
  try {
    const boatData = await import("./boatData.js");
    const name = req.params.boatName;
    const specs = boatData.getBoatSpecs?.(name) || boatData.BOAT_SPECS?.[name] || null;
    const milestones = boatData.BOAT_MILESTONES?.[name] || null;
    res.json({ boatName: name, specs, milestones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ STATIC FILES ============ */

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

 app.use(express.static(__dirname, {
  setHeaders(res, path, stat) {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

 app.use((req, res) => {
   console.error("[DEBUG 404] " + req.method + " " + req.originalUrl);
   res.status(404).json({ error: "Not found" });
 });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("SERVER RUNNING");
  console.log("http://localhost:" + PORT);
  console.log("API available at http://localhost:" + PORT + "/api");
});
