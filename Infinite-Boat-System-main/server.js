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

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid or expired token" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  req.user = user;
  req.profile = profile;
  next();
}

async function requireAdmin(req, res, next) {
  const isAdmin = req.profile?.role === "admin" || req.user?.user_metadata?.role === "admin";
  if (!isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
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

    const { data: userData, error: userError } = await supabaseServiceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { name: fullname },
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
    }, { onConflict: "id" });

    if (profileError) {
      console.error("[REGISTER] Profile upsert failed:", profileError);
    }

    const { data: linkData, error: linkError } = await supabaseServiceRole.auth.admin.generateLink({
      type: "signup",
      email,
      password,
    });

    if (linkError) {
      console.error("[REGISTER] Generate link failed:", linkError);
    }

    let verifyLink = linkData?.properties?.action_link || "";
    if (verifyLink) {
      verifyLink = verifyLink.replace("redirect_to=http://localhost:3000", "redirect_to=http://192.168.1.2:3000/verification-success.html");
    } else {
      verifyLink = `${process.env.SERVER_URL || "http://localhost:3000"}/api/auth/verify-email?token=none&uid=${userData.user.id}`;
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

/* ============ ORDERS ============ */

app.get("/api/orders", authenticate, async (req, res) => {
  try {
    let query = supabase.from("boat_orders").select("*").order("createdAt", { ascending: false });

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

    if (req.profile?.role !== "admin" && req.user?.user_metadata?.role !== "admin" && existing.userId !== req.user.id) {
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

app.post("/api/workers", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("project_workers").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers/seed", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data: existing } = await adminDb.from("workers").select("name").limit(1);
    if (existing && existing.length > 0) return res.json({ seeded: false, reason: "already seeded" });
    const { data, error } = await adminDb.from("workers").insert(req.body.workers).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ seeded: true, count: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/workers/master", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("workers").select("*").order("name", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers/auto-assign/:orderId", authenticate, async (req, res) => {
  try {
    const { data: order } = await adminDb
      .from("boat_orders")
      .select("userId")
      .eq("orderId", req.params.orderId)
      .single();
    if (!order) return res.status(404).json({ error: "Order not found" });
    const isAdmin = req.profile?.role === "admin" || req.user?.user_metadata?.role === "admin";
    if (!isAdmin && order.userId !== req.user.id) {
      return res.status(403).json({ error: "Not your order" });
    }

    const { data: existing } = await adminDb
      .from("project_workers")
      .select("id")
      .eq("orderId", req.params.orderId);
    if (existing && existing.length > 0) return res.json({ assigned: false, reason: "already assigned" });

    const { data: allWorkers } = await adminDb.from("workers").select("*");
    if (!allWorkers || allWorkers.length === 0) return res.status(400).json({ error: "No workers in registry" });

    const assignments = allWorkers.map(w => ({
      orderId: req.params.orderId,
      name: w.name,
      role: w.specialty,
      status: "Active"
    }));
    const { data, error } = await adminDb.from("project_workers").insert(assignments).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ assigned: true, count: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/workers/:id", authenticate, requireAdmin, async (req, res) => {
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

app.post("/api/tasks", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("project_tasks").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", authenticate, requireAdmin, async (req, res) => {
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

app.delete("/api/tasks/:id", authenticate, requireAdmin, async (req, res) => {
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

app.get("/api/reports/summary", authenticate, requireAdmin, async (req, res) => {
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("SERVER RUNNING");
  console.log("http://localhost:" + PORT);
  console.log("API available at http://localhost:" + PORT + "/api");
});
