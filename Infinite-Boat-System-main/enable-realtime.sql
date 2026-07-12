-- ============================================
-- ENABLE SUPABASE REALTIME FOR TABLES
-- Run this in Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New Query
-- ============================================

-- 1. Check current publication status
SELECT * FROM pg_publication WHERE pubname = 'supabase_realtime';

-- 2. Check which tables are currently in the publication
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- 3. Create publication if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- 4. Add tables safely (ignore if already member)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'boat_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.boat_orders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'dashboard_payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_payments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'inventory') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
  END IF;
END $$;

-- 5. Verify tables were added
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
