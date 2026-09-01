-- RESET: Release (complete) ALL Active worker assignments so every worker
-- in the registry is available again. Use this to TEST auto-assign from a
-- clean slate (each worker will then be re-assigned by the next auto-assign).
--
-- Run in the Supabase SQL Editor.

UPDATE public.project_workers
SET status = 'Completed',
    "completedAt" = NOW(),
    "updatedAt" = NOW(),
    "endDate" = COALESCE("endDate", NOW())
WHERE status = 'Active';
