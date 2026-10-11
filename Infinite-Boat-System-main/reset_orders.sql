-- ============================================
-- RESET: Clear ALL orders (orders only)
-- Run in Supabase SQL Editor.
-- Deletes every row in public.boat_orders.
--
-- Note: dashboard_payments, project_tasks and project_workers reference
-- boat_orders("orderId") with ON DELETE CASCADE, so their rows for these
-- orders are removed automatically. Profiles, inventory, workers and
-- notifications are NOT touched.
--
-- WARNING: This is irreversible. No backup is taken here.
-- ============================================

DELETE FROM public.boat_orders;

-- ===== VERIFY (expect 0 for each) =====
SELECT count(*) AS orders          FROM public.boat_orders;
SELECT count(*) AS payments        FROM public.dashboard_payments;
SELECT count(*) AS tasks           FROM public.project_tasks;
SELECT count(*) AS project_workers FROM public.project_workers;
