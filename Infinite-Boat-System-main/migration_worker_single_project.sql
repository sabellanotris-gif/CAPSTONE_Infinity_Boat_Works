-- Enforce the single-project rule for existing data: a worker may only be
-- Active on ONE project (orderId). For any worker currently Active on more
-- than one project, keep only their EARLIEST assignment and release
-- (complete) the duplicate Active rows on other projects.
--
-- Run once in the Supabase SQL Editor.

-- 1) Identify, per worker, their earliest (keep) order and the duplicate order(s).
WITH ranked AS (
  SELECT
    id,
    "name",
    "orderId",
    ROW_NUMBER() OVER (PARTITION BY "name" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM public.project_workers
  WHERE status = 'Active'
),
kept AS (
  SELECT "name", MIN("orderId") AS keep_order
  FROM ranked
  WHERE rn = 1
  GROUP BY "name"
)
-- 2) Release (complete) the Active rows that are on a different project.
UPDATE public.project_workers pw
SET status = 'Completed',
    "completedAt" = NOW(),
    "updatedAt" = NOW()
FROM kept k
WHERE pw.status = 'Active'
  AND pw."name" = k."name"
  AND pw."orderId" <> k.keep_order;
