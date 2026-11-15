-- ============================================================
-- Payment reminders sent by managers/admins to customers
-- Stores the last reminder (timestamp, message, phase, amount, sender)
-- on the order so the dashboard can show "last reminder sent" and keep
-- a lightweight audit trail.
-- ============================================================

ALTER TABLE public.boat_orders
  ADD COLUMN IF NOT EXISTS "paymentReminder" JSONB;

-- Notify PostgREST/Supabase to pick up the new column immediately.
NOTIFY pgrst, 'reload schema';
