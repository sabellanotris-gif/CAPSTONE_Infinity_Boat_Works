-- ============================================================
-- Normalize the client role from 'user' to 'customer'
-- ============================================================
-- The system historically used 'user' as the default role for clients while
-- newer code, RLS policies and migrations expect 'customer'. This migration
-- makes the data consistent without ever touching staff accounts.
--
-- Safe to run repeatedly (idempotent). Run once in the Supabase SQL Editor.

-- 1. Convert every legacy client row. NEVER demote admin / manager / worker.
UPDATE public.profiles
SET role = 'customer'
WHERE role IS NULL
   OR role = 'user';

-- 2. Ensure the column default matches the normalized value.
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'customer';

-- 3. Keep handle_new_user() consistent: unknown metadata falls back to
--    'customer' (the seeded admin email still resolves to 'admin').
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
      CASE WHEN NEW.email = 'infinityboatsystem@gmail.com' THEN 'admin' ELSE 'customer' END
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Keep the role-lock trigger consistent: a self-assigned admin is forced
--    back to 'customer' (not the legacy 'user').
CREATE OR REPLACE FUNCTION public.lock_profile_role()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'admin' AND NOT public.is_admin() AND NEW.email <> 'infinityboatsystem@gmail.com' THEN
      NEW.role := 'customer';
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
