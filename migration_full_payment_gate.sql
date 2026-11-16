-- Migration: full payment unlocks the build immediately on approval
-- Run this in the Supabase SQL Editor.
--
-- The app now jumps paymentStep straight to 3 when an admin approves a
-- Full Payment. Legacy rows approved before that fix sit at step 1 with
-- remainingBalance = 0; move them to step 3 so the stored gate matches the UI.
-- step 1 is unambiguous here because only the approval flow can set it
-- (order creation always starts at step 0).
--
-- Idempotent: safe to run multiple times.

UPDATE public.boat_orders
SET "paymentStep" = 3
WHERE lower("paymentMethod") = 'full payment'
  AND COALESCE("remainingBalance", 0) <= 0
  AND "paymentStep" = 1;
