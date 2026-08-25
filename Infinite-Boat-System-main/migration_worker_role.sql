-- ============================================
-- MIGRATION: Worker Account System
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. WORKERS TABLE (with userId link for worker accounts)
CREATE TABLE IF NOT EXISTS public.workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "specialty" TEXT NOT NULL DEFAULT 'Builder',
  "status" TEXT DEFAULT 'Active',
  "userId" UUID REFERENCES public.profiles(id),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure userId column exists (handles case where schema.sql created table without it)
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS "userId" UUID REFERENCES public.profiles(id);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workers_master_select_all" ON public.workers;
CREATE POLICY "workers_master_select_all" ON public.workers
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "workers_master_admin_insert" ON public.workers;
CREATE POLICY "workers_master_admin_insert" ON public.workers
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "workers_master_admin_update" ON public.workers;
CREATE POLICY "workers_master_admin_update" ON public.workers
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "workers_master_admin_delete" ON public.workers;
CREATE POLICY "workers_master_admin_delete" ON public.workers
  FOR DELETE USING (public.is_admin());

-- 2. PROJECT WORKERS - add missing columns
ALTER TABLE public.project_workers
  ADD COLUMN IF NOT EXISTS "specialty" TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS "phase" TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ;

UPDATE public.project_workers
  SET "specialty" = "role"
  WHERE "specialty" = '' AND "role" IS NOT NULL AND "role" != '';

UPDATE public.project_workers pw
  SET "status" = 'Completed', "completedAt" = COALESCE(pw."completedAt", NOW())
  FROM public.boat_orders o
  WHERE o."orderId" = pw."orderId"
    AND o."status" IN ('Completed', 'Cancelled', 'Rejected')
    AND pw."status" = 'Active';

-- 3. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" TEXT DEFAULT 'general',
  "orderId" TEXT,
  "read" BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = "userId" OR public.is_admin());
CREATE POLICY "notifications_insert_admin" ON public.notifications
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = "userId" OR public.is_admin()) WITH CHECK (auth.uid() = "userId" OR public.is_admin());
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (auth.uid() = "userId" OR public.is_admin());

-- 4. WORKER REGISTRATIONS TABLE (pending approvals)
CREATE TABLE IF NOT EXISTS public.worker_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT DEFAULT '',
  "specialty" TEXT NOT NULL DEFAULT 'Builder',
  "status" TEXT DEFAULT 'pending',
  "reviewedBy" UUID REFERENCES public.profiles(id),
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.worker_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "worker_reg_select_own_or_admin" ON public.worker_registrations;
DROP POLICY IF EXISTS "worker_reg_insert_own" ON public.worker_registrations;
DROP POLICY IF EXISTS "worker_reg_admin_all" ON public.worker_registrations;

CREATE POLICY "worker_reg_select_own_or_admin" ON public.worker_registrations
  FOR SELECT USING (auth.uid() = "userId" OR public.is_admin());
CREATE POLICY "worker_reg_insert_own" ON public.worker_registrations
  FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "worker_reg_admin_all" ON public.worker_registrations
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5. UPDATE ROLE LOCK TRIGGER to allow 'worker' role
CREATE OR REPLACE FUNCTION public.lock_profile_role()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'admin' AND NOT public.is_admin() AND NEW.email <> 'infinityboatsystem@gmail.com' THEN
      NEW.role := 'user';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF public.is_admin() THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot change role. Only admins may change roles.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profile_role_lock ON public.profiles;
CREATE TRIGGER profile_role_lock
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.lock_profile_role();

-- 6. UPDATE handle_new_user trigger to support worker role from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, photo, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'photo', './images/user.png'),
    COALESCE(NEW.raw_user_meta_data->>'role',
      CASE WHEN NEW.email = 'infinityboatsystem@gmail.com' THEN 'admin' ELSE 'user' END
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
