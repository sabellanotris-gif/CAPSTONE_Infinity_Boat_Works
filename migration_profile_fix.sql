-- Fix: profiles table fixes.
-- 1) Add the phone column (registration/profile already read/write it).
-- 2) Allow users to insert/upsert their own profile row (client-side upsert
--    previously always failed with an RLS error because there was no INSERT policy).
-- Run this once in the Supabase SQL Editor.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
