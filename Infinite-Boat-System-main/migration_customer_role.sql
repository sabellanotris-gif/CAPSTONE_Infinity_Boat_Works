-- Assign existing customers (non-admin, non-worker) the 'customer' role.
-- Run once in the Supabase SQL Editor.
UPDATE public.profiles
SET role = 'customer'
WHERE role IS NULL
   OR role NOT IN ('admin', 'worker', 'customer');
