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

  // Create an authed client with the user's token so RLS policies apply
  let profile = null;
  try {
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data } = await userClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    profile = data;
    // Fallback: try by email if id lookup fails
    if (!profile && user.email) {
      const { data: emailProfile } = await userClient
        .from("profiles")
        .select("*")
        .eq("email", user.email)
        .maybeSingle();
      profile = emailProfile;
    }
  } catch (e) {
    console.warn("[AUTH] Profile fetch failed (non-fatal):", e?.message || e);
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

app.put("/api/orders/:orderId/delivery", authenticate, requireAdmin, async (req, res) => {
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

// Resolve the current phase key of an order from its milestones (normalized by percentage)
async function resolveCurrentPhaseKey(orderId, boatName) {
  const { data: order } = await adminDb
    .from("boat_orders")
    .select("milestones, progress, boatName")
    .eq("orderId", orderId)
    .single();
  const name = boatName || order?.boatName || "";
  const milestones = order?.milestones || [];

  if (Array.isArray(milestones) && milestones.length > 0) {
    const firstIncomplete = milestones.find(m => !m.completed);
    if (firstIncomplete) {
      const key = firstIncomplete.key || await resolveMilestoneKeyByPercentage(name, firstIncomplete);
      if (key) return key;
    }
  }

  const { data: lastActive } = await adminDb
    .from("project_workers")
    .select("phase")
    .eq("orderId", orderId)
    .eq("status", "Active")
    .limit(1);
  if (lastActive && lastActive.length > 0 && lastActive[0].phase) return lastActive[0].phase;

  const boatData = await import("./boatData.js");
  const presets = boatData.getBoatMilestones?.(name) || [];
  if (presets.length > 0) {
    const progress = order?.progress || 0;
    const current = [...presets].reverse().find(p => progress >= p.percentage);
    return current ? current.key : presets[0].key;
  }
  return "design";
}

async function resolveMilestoneKeyByPercentage(boatName, milestone) {
  if (milestone.key) return milestone.key;
  if (milestone.percentage == null) return "";
  const boatData = await import("./boatData.js");
  const presets = boatData.getBoatMilestones?.(boatName) || [];
  const match = presets.find(p => p.percentage === milestone.percentage);
  return match ? match.key : "";
}

// Core: assign available workers whose specialty matches the phase (exclusive)
async function assignWorkersForPhase(orderId, phase, opts = {}) {
  const { data: order } = await adminDb
    .from("boat_orders")
    .select("userId, customerEmail")
    .eq("orderId", orderId)
    .single();
  if (!order) return { error: "Order not found", status: 404 };

  const boatData = await import("./boatData.js");
  const SPECIALTY_PHASES = boatData.SPECIALTY_PHASES || {};
  const phasesForSpecialty = (spec) => {
    for (const [s, keys] of Object.entries(SPECIALTY_PHASES)) {
      if (s.toLowerCase() === String(spec).toLowerCase()) return keys;
    }
    return SPECIALTY_PHASES[spec] || [];
  };

  const { data: existing } = await adminDb
    .from("project_workers")
    .select("id, name, phase, status")
    .eq("orderId", orderId);
  const alreadyAssignedForPhase = new Set(
    (existing || []).filter(w => w.status === "Active" && w.phase === phase).map(w => w.name)
  );

  const { data: allWorkers } = await adminDb.from("workers").select("*");
  if (!allWorkers || allWorkers.length === 0) return { error: "No workers in registry", status: 400 };

  // Exclusive check: workers with Active assignment on any other order
  const { data: activeOnOthers } = await adminDb
    .from("project_workers")
    .select("name")
    .eq("status", "Active")
    .neq("orderId", orderId);
  const busyWorkers = new Set((activeOnOthers || []).map(w => w.name));

  const candidates = allWorkers.filter(w => phasesForSpecialty(w.specialty).includes(phase));

  const assignments = [];
  const skipped = [];
  candidates.forEach(w => {
    if (alreadyAssignedForPhase.has(w.name)) return;
    if (!opts.allowBusy && busyWorkers.has(w.name)) {
      skipped.push({ name: w.name, specialty: w.specialty, reason: "busy" });
      return;
    }
    assignments.push({
      orderId,
      name: w.name,
      role: w.specialty,
      specialty: w.specialty,
      phase,
      status: "Active"
    });
  });

  let inserted = [];
  if (assignments.length > 0) {
    const { data, error } = await adminDb.from("project_workers").insert(assignments).select();
    if (error) return { error: error.message, status: 500 };
    inserted = data;
  }
  return { assigned: true, count: inserted.length, phase, skipped };
}

app.post("/api/workers/auto-assign/:orderId", authenticate, async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { data: order } = await adminDb
      .from("boat_orders")
      .select("userId, customerEmail")
      .eq("orderId", orderId)
      .single();
    if (!order) return res.status(404).json({ error: "Order not found" });
    const isAdmin = req.profile?.role === "admin" || req.user?.user_metadata?.role === "admin";
    const isOwner = order.userId === req.user.id;
    const isCustomer = order.customerEmail?.toLowerCase() === req.user.email?.toLowerCase();
    if (!isAdmin && !isOwner && !isCustomer) {
      return res.status(403).json({ error: "Not your order" });
    }

    const phase = await resolveCurrentPhaseKey(orderId);
    const result = await assignWorkersForPhase(orderId, phase);
    if (result.status) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers/release-phase/:orderId", authenticate, async (req, res) => {
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

app.post("/api/workers/assign-phase/:orderId", authenticate, async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { phase } = req.body || {};
    if (!phase) return res.status(400).json({ error: "phase is required" });
    const result = await assignWorkersForPhase(orderId, phase);
    if (result.status) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("SERVER RUNNING");
  console.log("http://localhost:" + PORT);
  console.log("API available at http://localhost:" + PORT + "/api");
});
