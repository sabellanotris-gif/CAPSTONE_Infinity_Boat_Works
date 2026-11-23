-- RESET: Reactivate the whole registry and release (complete) ALL Active
-- worker assignments so every worker is available again. Use this to TEST
-- auto-assign from a clean slate (each worker will then be re-assigned by the
-- next auto-assign).
--
-- Run in the Supabase SQL Editor.

-- 1) Make sure no worker is deactivated in the registry.
UPDATE public.workers
SET status = 'Active'
WHERE status IS DISTINCT FROM 'Active';

-- 2) Complete every active assignment so nobody is busy.
UPDATE public.project_workers
SET status = 'Completed',
    "completedAt" = NOW(),
    "updatedAt" = NOW(),
    "endDate" = COALESCE("endDate", NOW())
WHERE status = 'Active';
