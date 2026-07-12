# System Alignment — Smart Digital Boat

**Title:** Smart Digital Boat: Immersive 3D Customization and Project Management

---

## 1. Current Alignment

| Area | Status | Notes |
|---|---|---|
| **Boat Ordering System** | ✅ Done | Full order workflow: Pending → Approved → Construction → Completed |
| **Custom Build (2D Configurator)** | ⚠️ Partial | 2D Canvas, not actual 3D. Will upgrade to Three.js/WebGL next phase |
| **Payment Management** | ✅ Done | Bank details, company account info, approve/reject, payment steps, success feedback |
| **Admin Dashboard** | ✅ Done | Analytics cards, live projects, recent payments, inventory alerts, notifications |
| **Customer Project View** | ✅ Done | 6-tab panel: Progress, Activity, Materials, Timeline, Delivery, Payments |
| **Boat Progress Tracking** | ✅ Done | Circular gauge, build stages, milestones, activity log, timeline steps |
| **Cancellation Flow** | ✅ Done | Request → Approve/Reject → Cancelled or returned to previous status |
| | | |

---

## 2. Planned Improvements — Project Management

### 2.1 Gantt Chart — Visual Timeline

**Goal:** Render an interactive Gantt chart in `dashprogress.html` showing each construction phase with start/end dates and current progress.

**Data Source:** `boatData.js` → `BOAT_TIMELINE` (already has phase durations per boat type)

**Features:**
- Horizontal bar chart per phase
- Current phase highlighted
- % completion overlay
- Target dates (admin input or auto-calculated from order date)
- Responsive design

### 2.2 Task Management Board

**Goal:** Add task assignment, prioritization, and status tracking.

**New DB Table:**
```sql
CREATE TABLE public.project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" TEXT REFERENCES public.boat_orders("orderId") ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assignedTo TEXT DEFAULT '',
  priority TEXT DEFAULT 'Medium',   -- High / Medium / Low
  status TEXT DEFAULT 'Not Started', -- Not Started / In Progress / Done
  dueDate DATE,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);
```

**Features:**
- Admin: Create/edit tasks per order in `dashprogress`
- Admin: Assign workers, set priority and due date
- Customer: View tasks in `home.js` progress tab
- Status filter (Not Started / In Progress / Done)
- Dashboard widget: overdue tasks alert

### 2.3 Workers → Database Migration

**Goal:** Move worker data from localStorage to existing `project_workers` table.

**Changes:**
- `dashprogress.js`: Replace `localStorage` reads/writes with Supabase queries to `project_workers` table
- `home.js`: Fetch workers from DB instead of demo data
- Persistent across devices and browser resets

### 2.4 Dashboard — Project Alerts Widget

**Goal:** Add upcoming milestones and overdue tasks to `dashboard.html`.

**Widgets:**
- "Upcoming Milestones" — next 3 milestones due sorted by date
- "Overdue Tasks" — tasks past due date
- "Projects by Phase" — count per build stage

---

## 3. Implementation Roadmap

| Phase | Feature | DB Changes | Files Affected |
|---|---|---|---|
| **Phase 1** | Gantt Chart | None | `dashprogress.html`, `dashprogress.js`, `dashprogress.css`, `boatData.js` |
| **Phase 2a** | Task Management | New `project_tasks` table | `dashprogress.html`, `dashprogress.js`, `dashprogress.css`, `home.js`, `home.css` |
| **Phase 2b** | Workers → DB | Existing `project_workers` table | `dashprogress.js`, `home.js` |
| **Phase 3** | Dashboard Alerts | None | `dashboard.html`, `dashboard.js` |

---

## 4. Future (Next Phase)

- **Immersive 3D Customization** — Upgrade from 2D Canvas to Three.js/WebGL with orbit controls and 3D model loading
- **Real-time WebSocket updates** — Live progress notifications without page refresh
- **Photo uploads per progress update** — Construction photo gallery per order

---

*Last updated: June 2026*
