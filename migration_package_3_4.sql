-- Run this in Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New Query → Paste → Run

-- Package 3: Progress Photos
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "progressPhotos" JSONB DEFAULT '[]';

-- Package 4: Budget & Resources
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "budgetInfo" JSONB DEFAULT '{}';

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'boat_orders' AND column_name IN ('progressPhotos', 'budgetInfo')
ORDER BY column_name;

-- Ensure realtime is enabled
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'boat_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.boat_orders;
  END IF;
END $$;
