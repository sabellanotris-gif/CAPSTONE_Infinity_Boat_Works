-- ============================================
-- DROP EXISTING TABLES (if any)
-- ============================================
DROP TABLE IF EXISTS public.project_workers CASCADE;
DROP TABLE IF EXISTS public.dashboard_payments CASCADE;
DROP TABLE IF EXISTS public.boat_orders CASCADE;
DROP TABLE IF EXISTS public.inventory CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ===== PROFILES =====
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  photo TEXT DEFAULT './images/user.png',
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Set admin for the admin email
UPDATE public.profiles SET role = 'admin' WHERE email = 'infinityboatsystem@gmail.com';

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, photo, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'photo', './images/user.png'),
    COALESCE(NEW.raw_user_meta_data->>'role', CASE WHEN NEW.email = 'infinityboatsystem@gmail.com' THEN 'admin' ELSE 'user' END)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== BOAT ORDERS =====
-- Using double-quoted camelCase to match JS code's insert/read property names
CREATE TABLE public.boat_orders (
  "orderId" TEXT PRIMARY KEY,
  "userId" UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  "boatName" TEXT,
  "boatImage" TEXT,
  "boatPrice" TEXT,
  "buildTime" TEXT,
  "downpayment" TEXT DEFAULT 'N/A',
  "paymentMethod" TEXT DEFAULT 'Full Payment',
  "customerName" TEXT,
  "customerEmail" TEXT,
  "customerPhone" TEXT DEFAULT '',
  "customerAddress" TEXT DEFAULT '',
  "validId" TEXT DEFAULT '',
  "notes" TEXT DEFAULT '',
  "status" TEXT DEFAULT 'Pending',
  "progress" INTEGER DEFAULT 0,
  "paymentStep" INTEGER DEFAULT 0,
  "remainingBalance" NUMERIC DEFAULT 0,
  "orderPhase" TEXT DEFAULT 'Awaiting Contract Signing',
  "buildType" TEXT DEFAULT 'standard',
  "ackResponses" JSONB DEFAULT '[]',
  "ackComments" JSONB DEFAULT '{}',
  "contractSchedule" TEXT,
  "customConfig" JSONB,
  "guidelineResponses" JSONB DEFAULT '{}',
  "guidelineComments" JSONB DEFAULT '{}',
  "reviewFeedback" TEXT DEFAULT '',
  "reviewStatus" TEXT DEFAULT '',
  "signature" TEXT DEFAULT '',
  "milestones" JSONB DEFAULT '[]',
  "activityLog" JSONB DEFAULT '[]',
  "paymentHistory" JSONB DEFAULT '[]',
  "projectCompletedDate" TIMESTAMPTZ,
  "cancelApprovedAt" TIMESTAMPTZ,
  "cancelRejectFeedback" TEXT DEFAULT '',
  "cancelRejectedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
  "cancelReason" TEXT DEFAULT '',
  "cancelSignature" TEXT DEFAULT '',
  "cancelFee" NUMERIC DEFAULT 0,
  "cancelMaterials" JSONB DEFAULT '[]',
  "previousStatus" TEXT DEFAULT '',
  "cancelRequestedAt" TIMESTAMPTZ,
  "cancelPaidAt" TIMESTAMPTZ
);

-- ===== DASHBOARD PAYMENTS =====
CREATE TABLE public.dashboard_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" TEXT REFERENCES public.boat_orders("orderId") ON DELETE CASCADE,
  "userId" UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  "customerName" TEXT,
  "customerEmail" TEXT,
  "boatName" TEXT,
  "amount" NUMERIC DEFAULT 0,
  "phase" TEXT,
  "paymentStep" INTEGER DEFAULT 0,
  "bank" TEXT DEFAULT '',
  "reference" TEXT DEFAULT '',
  "proofImage" TEXT DEFAULT '',
  "status" TEXT DEFAULT 'Pending',
  "remainingBalance" NUMERIC DEFAULT 0,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ===== INVENTORY =====
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT,
  "category" TEXT,
  "stock" INTEGER DEFAULT 0,
  "price" NUMERIC DEFAULT 0,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ===== PROJECT TASKS =====
CREATE TABLE public.project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" TEXT REFERENCES public.boat_orders("orderId") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT DEFAULT '',
  "assignedTo" TEXT DEFAULT '',
  "priority" TEXT DEFAULT 'Medium',
  "status" TEXT DEFAULT 'Not Started',
  "dueDate" DATE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ===== PROJECT WORKERS =====
CREATE TABLE public.project_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" TEXT REFERENCES public.boat_orders("orderId") ON DELETE CASCADE,
  "name" TEXT,
  "role" TEXT,
  "startDate" DATE,
  "endDate" DATE,
  "status" TEXT DEFAULT 'Active',
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ===== WORKERS MASTER LIST =====
CREATE TABLE public.workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "specialty" TEXT NOT NULL DEFAULT 'Builder',
  "status" TEXT DEFAULT 'Active',
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ===== ROW LEVEL SECURITY =====
-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boat_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

-- Helper: admin check function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ===== PROFILES RLS =====
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ===== BOAT ORDERS RLS =====
DROP POLICY IF EXISTS "orders_select_own_or_admin" ON public.boat_orders;
DROP POLICY IF EXISTS "orders_insert_own" ON public.boat_orders;
DROP POLICY IF EXISTS "orders_update_own_or_admin" ON public.boat_orders;
DROP POLICY IF EXISTS "orders_delete_admin_only" ON public.boat_orders;
CREATE POLICY "orders_select_own_or_admin" ON public.boat_orders
  FOR SELECT USING (auth.uid() = "userId" OR public.is_admin());
CREATE POLICY "orders_insert_own" ON public.boat_orders
  FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "orders_update_own_or_admin" ON public.boat_orders
  FOR UPDATE USING (auth.uid() = "userId" OR public.is_admin()) WITH CHECK (auth.uid() = "userId" OR public.is_admin());
CREATE POLICY "orders_delete_admin_only" ON public.boat_orders
  FOR DELETE USING (public.is_admin());

-- ===== DASHBOARD PAYMENTS RLS =====
DROP POLICY IF EXISTS "payments_select_own_or_admin" ON public.dashboard_payments;
DROP POLICY IF EXISTS "payments_insert_own" ON public.dashboard_payments;
DROP POLICY IF EXISTS "payments_update_admin" ON public.dashboard_payments;
CREATE POLICY "payments_select_own_or_admin" ON public.dashboard_payments
  FOR SELECT USING (auth.uid() = "userId" OR public.is_admin());
CREATE POLICY "payments_insert_own" ON public.dashboard_payments
  FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "payments_update_admin" ON public.dashboard_payments
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ===== INVENTORY RLS =====
DROP POLICY IF EXISTS "inventory_select_all" ON public.inventory;
DROP POLICY IF EXISTS "inventory_admin_all" ON public.inventory;
CREATE POLICY "inventory_select_all" ON public.inventory
  FOR SELECT USING (true);
CREATE POLICY "inventory_admin_all" ON public.inventory
  FOR INSERT USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "inventory_admin_update" ON public.inventory
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "inventory_admin_delete" ON public.inventory
  FOR DELETE USING (public.is_admin());

-- ===== PROJECT WORKERS RLS =====
DROP POLICY IF EXISTS "workers_select_own_order_or_admin" ON public.project_workers;
DROP POLICY IF EXISTS "workers_admin_all" ON public.project_workers;
CREATE POLICY "workers_select_own_order_or_admin" ON public.project_workers
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.boat_orders
      WHERE "orderId" = project_workers."orderId"
      AND ("userId" = auth.uid() OR "customerEmail" = auth.email())
    )
  );
CREATE POLICY "workers_admin_insert" ON public.project_workers
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "workers_admin_update" ON public.project_workers
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "workers_admin_delete" ON public.project_workers
  FOR DELETE USING (public.is_admin());

-- ===== WORKERS MASTER RLS =====
DROP POLICY IF EXISTS "workers_master_admin_all" ON public.workers;
DROP POLICY IF EXISTS "workers_master_select_all" ON public.workers;
CREATE POLICY "workers_master_select_all" ON public.workers
  FOR SELECT USING (true);
CREATE POLICY "workers_master_admin_insert" ON public.workers
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "workers_master_admin_update" ON public.workers
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "workers_master_admin_delete" ON public.workers
  FOR DELETE USING (public.is_admin());

-- ===== PROJECT TASKS RLS =====
DROP POLICY IF EXISTS "tasks_select_own_order_or_admin" ON public.project_tasks;
DROP POLICY IF EXISTS "tasks_admin_all" ON public.project_tasks;
CREATE POLICY "tasks_select_own_order_or_admin" ON public.project_tasks
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.boat_orders
      WHERE "orderId" = project_tasks."orderId" AND "userId" = auth.uid()
    )
  );
CREATE POLICY "tasks_admin_insert" ON public.project_tasks
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "tasks_admin_update" ON public.project_tasks
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "tasks_admin_delete" ON public.project_tasks
  FOR DELETE USING (public.is_admin());

-- Migration: Add phone column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';

-- Migration: Add accountName/accountNumber to dashboard_payments
ALTER TABLE public.dashboard_payments ADD COLUMN IF NOT EXISTS "accountName" TEXT DEFAULT '';
ALTER TABLE public.dashboard_payments ADD COLUMN IF NOT EXISTS "accountNumber" TEXT DEFAULT '';

-- Migration: Fix column casing for project_tasks (PG folds unquoted mixed-case to lowercase)
ALTER TABLE public.project_tasks ADD COLUMN IF NOT EXISTS "assignedTo" TEXT DEFAULT '';
ALTER TABLE public.project_tasks ADD COLUMN IF NOT EXISTS "dueDate" DATE;

-- Migration: Add metadata column to inventory for 3D customization parts
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}';

-- Migration: Add cancellation columns (skip if already exist)
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelReason" TEXT DEFAULT '';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelSignature" TEXT DEFAULT '';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelFee" NUMERIC DEFAULT 0;
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelMaterials" JSONB DEFAULT '[]';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "previousStatus" TEXT DEFAULT '';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMPTZ;
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelApprovedAt" TIMESTAMPTZ;
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelRejectFeedback" TEXT DEFAULT '';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelRejectedAt" TIMESTAMPTZ;
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "cancelPaidAt" TIMESTAMPTZ;

-- Migration: Add progressPhotos and budgetInfo columns (Package 3 & 4)
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "progressPhotos" JSONB DEFAULT '[]';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "budgetInfo" JSONB DEFAULT '{}';
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "documents" JSONB DEFAULT '[]';

-- Migration: Delivery Tracking fields (stored in "deliveryInfo" JSONB on boat_orders)
-- The "deliveryInfo" JSONB column stores the following delivery-related fields:
-- {
--   "deliveryStatus": "Preparing for Delivery" | "Ready for Delivery" | "In Transit" | "Delivered",
--   "committedDeliveryDate": "January 15, 2026",
--   "expectedDate": "January 15, 2026",
--   "actualDeliveryDate": "January 20, 2026",
--   "deliveryLocation": "Customer address or port",
--   "contactPerson": "Customer name",
--   "seaTrialResults": "Passed" | "Failed" | "Pending" | "Conditional",
--   "deliveryProgress": 0-100,
--   "deliveryConfirmed": true | false,
--   "delayDays": 5,
--   "delayPenalty": 2500000,
--   "delayPenaltyPercent": 5,
--   "delayReason": "Weather delays caused...",
--   "delayNotified": true | false,
--   "deliveryNotes": "Admin notes about delivery"
-- }
-- Delay penalty is auto-calculated when actualDeliveryDate > committedDeliveryDate:
--   1-7 days late = 1% of boat price
--   8-14 days late = 2% of boat price
--   15-30 days late = 5% of boat price
--   31+ days late = 8% of boat price (capped)

-- ============================================
-- ENABLE SUPABASE REALTIME
-- ============================================
-- Run in Supabase SQL Editor if real-time isn't working:
-- CREATE PUBLICATION IF NOT EXISTS supabase_realtime;
-- DO $$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'boat_orders') THEN
--     ALTER PUBLICATION supabase_realtime ADD TABLE public.boat_orders;
--   END IF;
--   IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'dashboard_payments') THEN
--     ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_payments;
--   END IF;
--   IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'inventory') THEN
--     ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
--   END IF;
-- END $$;

-- Storage RLS policies for boat-files bucket
DROP POLICY IF EXISTS "allow_upload_boat_files" ON storage.objects;
DROP POLICY IF EXISTS "allow_read_boat_files" ON storage.objects;

CREATE POLICY "allow_upload_boat_files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'boat-files');

CREATE POLICY "allow_read_boat_files"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'boat-files');
