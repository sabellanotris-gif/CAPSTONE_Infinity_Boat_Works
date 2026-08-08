-- ===== PHASE-BASED WORKER SCHEDULING MIGRATION =====
-- Adds columns to project_workers for tracking specialty + phase + release time.
-- Run this once against the Supabase database (SQL Editor).

ALTER TABLE public.project_workers
  ADD COLUMN IF NOT EXISTS "specialty" TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS "phase" TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ;

-- Backfill specialty from existing role (role currently stores the specialty)
UPDATE public.project_workers
  SET "specialty" = "role"
  WHERE "specialty" = '' AND "role" IS NOT NULL AND "role" != '';

-- Release workers stuck on finished orders (Completed / Cancelled / Rejected)
-- so they become available for new orders. Otherwise every worker is marked
-- "Active" forever and new orders get zero assignments.
UPDATE public.project_workers pw
  SET "status" = 'Completed', "completedAt" = COALESCE(pw."completedAt", NOW())
  FROM public.boat_orders o
  WHERE o."orderId" = pw."orderId"
    AND o."status" IN ('Completed', 'Cancelled', 'Rejected')
    AND pw."status" = 'Active';
