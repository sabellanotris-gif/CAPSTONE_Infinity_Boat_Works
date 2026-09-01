-- Adds the flag used to prevent double-deduction of inventory materials.
-- Run once in the Supabase SQL Editor.
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "materialsDeducted" BOOLEAN DEFAULT false;
