-- Hardening: prevent users from assigning themselves (or anyone) the admin role.
-- RLS policies alone cannot reference NEW/OLD in Supabase's editor, so the
-- protection lives in a BEFORE INSERT OR UPDATE trigger instead.
--   - INSERT: role is forced to 'user' unless the actor is an admin
--             (infinityboatsystem@gmail.com keeps the seeded admin role).
--   - UPDATE: the role column can never change unless the actor is an admin.
-- Run this once in the Supabase SQL Editor.

-- Restore the simple RLS policies (the trigger below does the real protection).
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Lock down the role column.
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
