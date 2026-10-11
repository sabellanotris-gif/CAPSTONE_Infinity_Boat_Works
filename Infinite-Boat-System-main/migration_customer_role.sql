-- Assign existing customers the 'customer' role.
-- Only the legacy default 'user' (or a NULL role) is normalized; staff roles
-- (admin, manager, worker) must never be demoted.
-- Run once in the Supabase SQL Editor.
UPDATE public.profiles
SET role = 'customer'
WHERE role IS NULL
   OR role = 'user';
