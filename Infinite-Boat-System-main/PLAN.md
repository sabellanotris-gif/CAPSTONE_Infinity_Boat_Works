FOR IMPROVEMENT 

add a button for minimize sa boat projects. para hindi makalat tignan.

MY BOAT PRJECTS SECTION and CUSTOMER DASHBOARD

sa ACTIVE, kapag full payment si client, dapat wala na yung proceed to payment na button kasi full payment na e? dapat more on monitoring nalang ng pag gawa ng boat niya yung nakikita, also sa payments dapat real time rin, nakita ko kasi na total contract, correct, Amount Paid is 0, which is mali, dapat kung magkano yung binayaran niya yon yung llabas don, sa remaining naman dapat 0 kasi fully paid na. tapos sa timeline lagyan natin ng completion date, sa patrol dapat in 8 months tapos na. then sa delivery dapat ganon din pero yon pwede tayo maglagay ng tentative habang di pa tapos yung process. also gusto ko real time yung date, kung anong date niya inorder dapat 8months from now yung makikita ko don. Also sa buildtime panel goods na. bale pwede pa yon mabago ah, kasi pag na check ni admin lahat tas kunware pag standard ng speed boat is 10months dapat sa custom si admin magbabago, goods yung under review perp dapat pwede baguhin ni admin yon, okay?


pero kapag installment, ofcourse dapat merong Proceed to Payment then dapat diba may panel tayo ng payment type, remaining, and buildtime. payment syempre installment, remaining namnan. diba may downpayment tayo na 10%? dapat after bayaran yon. then may nakita akong error. diba contract scheduling muna, pag check ko ng payments may amount paid na agad, yung 10% dapat wala pa yon, dapat 0 pa hanggat di pa na aapprove ni admin yung contract scheduling tapos don palang mag proceed sa 10% downpayment. next is gusto ko kita ni client yung pending niyang babayaran, for example sa 10% = 4m then next sa 40% = 20m para alam niya. tas kita rin kun magkano na lahat ng nabayran don sa amount paid. can we also create a button na parang list of reminder for client? like abt sa lahat? pero pag isipin muna natin if necessary. 

also sa total projects, active, completed, total payment, and remaining. pwede lagyan naitn ng cancelled order din na panel, and yung cancelled orders dapat kasama sa total projects (50/50 pa ko diyan) 

and also a each boat na inorder, kaya ba na parang summary ng inorder nila? basta laman lahat lang ng inorder para may babalikan sila if ever, tsaka baka diyan nalang din ipasok yung reminder 


ADDITIONAL IMPROVEMENT. 
pag first time user, dapat hindi WELCOME BACK. dapat welcome lang, welcome back pag 2nd time login niya na. okay?
---

# FOR IMPLEMENTATION (Organized Plan)

## Phase 1: Payments & Stats (User Dashboard)

### 1.1 Real-time Payment Display
- Amount Paid — fetch actual sum from `dashboard_payments` (status = Approved)
- Remaining Balance — `totalPrice - amountPaid`
- Total Contract — display correct boat price
- Fix: "Amount Paid = 0" → show real paid amount

### 1.2 Full Payment Mode
- Hide "Proceed to Payment" button when fully paid
- Show monitoring-only view (progress, timeline, delivery)

### 1.3 Installment Flow (Contract Signing First)
- After order placement → status = "Pending Contract Signing"
- Payments locked until admin approves contract schedule
- After admin approves → 10% downpayment becomes available
- Show pending payment breakdown (10% = ₱X, 40% = ₱X, 30% = ₱X, etc.)
- Amount Paid — cumulative sum of all approved payments

### 1.4 Stats Panel
- Add **Cancelled** counter
- Total Projects = Active + Completed + Cancelled (TBD)
- Hide Cancelled counter if zero

---

## Phase 2: Timeline & Delivery Dates

- Completion date — auto-compute from `createdAt` + boat build time (e.g., +8 months for Patrol)
- Tentative delivery date — editable placeholder until project is completed
- Real-time date display — shows "Expected: [date]" based on order date + build duration
- Admin adjustable build time — edit field in **order details page** (admin)
- Standard boats use preset build time; admin can override for custom orders

---

## Phase 3: Order Summary & UI

- **Minimize button** — collapsible project cards (toggle show/hide details)
- **Order summary card** — recap per boat:
  - Boat name, image, price
  - Build type (Standard / Custom)
  - Custom config (if custom)
  - Payment method (Full / Installment)
  - Status, progress
  - Order date, expected completion, delivery

---

## Phase 4: Reminders (TBD)

- Evaluate if necessary — list of reminders for client (payments, schedule, etc.)
- If yes, integrate into order summary card

---

## Phase 5: Admin Side (Next Steps)

- Order details page — edit build time, approve contract schedule
- Payment management — approve/reject payments
- More admin features (to be listed separately)

PAYMENT IMPROVEMENT 
this is for FullPayment. PAYMENT DETAILS gusto ko yung account name is yung name na ininput sa register to ensure na siya talaga mag oorder. sa account number, and reference dapat si user mag pprovide. kaya ba natin mag lagay ulit ng receive payment confirmation? or may mag mmessage nalang. sa order preview all goods. and sa payment receipt. 
if si user chooses installment or full payment and custom, napansin kong error is yung Payment method sa loob ng 3d is clickable parin. dapat hindi na kasi nakapili na si user before mapunta don, also the color of background ng remaining capacity is hindi na makita if ilan pa available. also sa hull color, remove the black kasi default na siya. and remove the build timeline. also sa pag cancel ng order, dapat kung accurate siya ah, like yung pinaka penalty na babayaran niya and yung details ng buong boat. para kita parin. i also observe that the user can input kahit anong gusto reference and account number, diba dapat bawal yon? kasi yon na yung pinaka number permanently. gusto ko sana kung ano ininput ni user na account number in the first is yon lang tatanggapin sa lahat ng transaction, cancel, pay basta transaction, yung sa reference ba? di ko sure pa. also sa yung sa name na nag sserve as signature gusto ko yung full name, no troll. kung anong name ininput sa register yon lang i accept.

3D CUSTOMIZER 
 is it okay if yung user is naoopen yon kahit wlang order na boat? napansin ko kasi na pwede siya ma access kahit walang boat. so im thinking if lagyan natin ng if the user dont order a boat, hindi pwede yon ma access. tas naisip ko nalang na kung pwede tayo gumawa ng preview ng boat na 3d? para makikita nila if mag 3-3d sila.
 napansin kong error is yung Payment method sa loob ng 3d is clickable parin. dapat hindi na kasi nakapili na si user before mapunta don, also the color of background ng remaining capacity is hindi na makita if ilan pa available. also sa hull color, remove the black kasi default na siya. and remove the build timeline. also sa pag cancel ng order, dapat kung accurate siya ah, like yung pinaka penalty na babayaran niya and yung details ng buong boat. para kita parin.

---

## Login & Registration Background Change

**Goal:** Change the full-page background of login and registration pages to plain white.

### Files to Edit

1. **`login.css:25`**
   - Current: `background:url("./images/background.png") no-repeat center center/cover;`
   - New: `background:#ffffff;`

2. **`registration.css:17`**
   - Current: `background:#ececec;`
   - New: `background:#ffffff;`

### Scope
- Only the `body` background changes to white
- Right-side panel images (`mainboat.jpg`) remain unchanged

---

# SYSTEM TECHNOLOGY STACK (for Methodology)

## Frontend (Client-Side)
| Technology | Purpose in the System |
|---|---|
| HTML5 | Page structure and content of all views (customer, admin, worker) |
| CSS3 | Styling, layout, and responsive design (per-page custom CSS) |
| JavaScript (ES6 Modules) | Client-side logic and interactivity across pages |
| Font Awesome (6.5.1) | UI and feature icons |
| Google Fonts (Poppins) | Typography |

## Visualization & 3D
| Technology | Purpose in the System |
|---|---|
| HTML5 Canvas API | 2D rendering of the boat customizer/builder view (`boatcust.js`) |
| Blender | 3D modeling and design of boat models used/represented in the system |

## Backend (Server-Side)
| Technology | Purpose in the System |
|---|---|
| Node.js | JavaScript runtime for the web server |
| Express.js (v5) | Web framework / REST API server on port 3000 |
| multer | File upload handling (project documents, progress photos) |
| nodemailer | Email automation (SMTP/Gmail) — verification, order, payment, status notifications |
| crypto (Node built-in) | Secure token generation for email verification |
| dotenv | Environment configuration via `.env` |

## Database & Backend-as-a-Service (Supabase)
| Technology | Purpose in the System |
|---|---|
| PostgreSQL | Relational database (profiles, boat_orders, payments, project_workers, worker_registrations, project_tasks, project_documents, etc.) |
| @supabase/supabase-js (v2) | Official JS client (anon-key user client + service-role admin client) |
| Supabase Auth | Authentication — email/password + Google OAuth, JWT sessions |
| Supabase Realtime | Real-time data updates and notifications |
| Supabase Storage | File and photo storage (`boat-files` bucket) |
| Row-Level Security (RLS) | Database access policies / permissions |

## Declared Dependencies (in package.json, not actively imported in the code)
- **jimp** — image manipulation (declared)
- **pg** — PostgreSQL driver (declared; DB access goes through the Supabase client)