-- Add notes column to project_workers for worker task comments/notes
ALTER TABLE public.project_workers
  ADD COLUMN IF NOT EXISTS "notes" TEXT DEFAULT '';

COMMENT ON COLUMN public.project_workers."notes" IS 'Free-text notes/comments a worker adds to their task assignment.';
