# SETUP INSTRUCTIONS — Infinity Boat System

Setup guide para patakbuhin ang system sa laptop/PC mo.

---

## Requirements

1. **Node.js** (LTS version)
   - Download: https://nodejs.org (click "LTS", install, i-restart ang terminal)
   - I-check sa terminal: `node -v` → dapat may lumabas na version (hal. `v20.x.x`)

---

## Step 1 — Kunin ang code

- **Option A (Git):**
  ```
  git clone https://github.com/sabellanotris-gif/CAPSTONE_Infinity_Boat_Works.git
  ```
- **Option B (ZIP):** Sa GitHub, click **Code → Download ZIP** → i-extract.

Buksan ang terminal at pumunta sa project folder:
```
cd CAPSTONE_Infinity_Boat_Works/Infinite-Boat-System-main
```

---

## Step 2 — I-install ang dependencies

```
npm install
```
Maghintay hanggang matapos (may lalabas na `node_modules` folder).

---

## Step 3 — Gumawa ng `.env` file

> ⚠️ **IMPORTANTE:** Ang `.env` ay may mga secret keys. **HUWAG i-commit sa GitHub** at huwag i-share sa iba maliban sa mga miyembro ng grupo.

Sa folder na `Infinite-Boat-System-main`, gumawa ng file na may pangalang **`.env`** at ilagay ang mga ito:

```
SUPABASE_URL=https://brpblkvthpdfbjqckqbk.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=infinityboatsystem@gmail.com
EMAIL_PASS=your-app-password
EMAIL_SECURE=false
ADMIN_EMAIL=infinityboatsystem@gmail.com
PORT=3000
SERVER_URL=http://localhost:3000
```

> Ang `SUPABASE_URL`, `SUPABASE_ANON_KEY`, at `SUPABASE_SERVICE_ROLE_KEY` ay dapat galing sa may-ari ng database (Project Settings → API sa Supabase dashboard).

---

## Step 4 — Gumawa ng admin account (kung wala pa)

```
node setup-admin.mjs <service_role_key>
```
Gumagawa ito ng admin accounts:
- `admin@gmail.com` / `admin12345`
- `infinityboatsystem@gmail.com` / `admin12345`

> Tawagan ang taong may database para i-confirm kung may admin na.

---

## Step 5 — Start ang server

```
node server.js
```

Dapat may lalabas na ganito:
```
Server running on http://localhost:3000
```

Buksan sa browser: **http://localhost:3000**

---

## Email setup (para gumana ang registration/verification)

Ang registration ay nagpapadala ng verification email gamit ang Gmail:
1. Gumawa ng Gmail account (o gamitin ang existing).
2. Google Account → **Security → 2-Step Verification → ON**
3. **App passwords → Create** → pumili ng "Mail" → i-copy ang 16-character password.
4. Ilagay sa `.env`: `EMAIL_USER=<gmail>` at `EMAIL_PASS=<app password>`.

---

## Bago ang presentation (checklist)

- [ ] `node server.js` tumatakbo
- [ ] Makapag-register ng bagong customer (may verification email)
- [ ] Makapag-login bilang admin (`admin@gmail.com` / `admin12345`)
- [ ] Gumagana ang workers (dashprogress) — may laman ang registry
- [ ] May internet connection (kailangan para sa online database)

---

## Troubleshooting

| Error | Solution |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` missing / "Server not configured for registration" | I-check na kumpleto ang `.env` |
| Port 3000 ginagamit na | Palitan ang `PORT` sa `.env`, o i-close ang ibang server |
| `window is not defined` | I-restart ang server (Ctrl+C, tapos `node server.js` ulit) |
| Walang lumalabas na workers sa dashprogress | I-run ang `migration_worker_phases.sql` sa Supabase SQL Editor |
| Registration error "Email not confirmed" | I-check ang email setup (Step: Email setup) |

---

*Para sa mga may-ari ng database: i-setup ang lahat ng tables at migrations sa Supabase SQL Editor — tingnan ang `schema.sql` at ang mga `migration_*.sql` na files.*
