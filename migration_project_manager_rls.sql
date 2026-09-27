-- Project Manager RLS — authoritative version
--
-- Supersedes migration_project_manager_role.sql. That file dropped policy names
-- that never existed (e.g. boat_orders_select_all_admin, project_tasks_select_all)
-- while the real policies are named orders_select_own_or_admin,
-- tasks_select_own_or_admin and so on. Every DROP there was a silent no-op, so the
-- original admin-only policies survived alongside the new manager ones. Postgres
-- ORs multiple permissive policies, so managers happened to work, but two real
-- problems were left behind:
--   1. project_workers and project_tasks SELECT were set to USING (true), which
--      let every authenticated customer read every assignment and task of every
--      order instead of only their own.
--   2. The duplicate policies accumulated on each run.
--
-- This version drops both the original admin-only policies and the wrongly-named
-- ones, then creates a single merged policy per operation. Customer access is
-- preserved explicitly in every case — dropping the old policy without
-- re-granting auth.uid() = "userId" would lock customers out of their own orders.
--
-- Idempotent. Safe to run whether or not the superseded file was ever applied.

-- ===== Helper functions =====
create or replace function public.is_manager()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.is_manager();
$$;

-- ===== profiles =====
-- Managers read other profiles (worker names, customers). Writes stay self-only.
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin_or_manager());

-- ===== boat_orders =====
-- Managers own Boat Progress, so they need to read every order and write the
-- progress columns. INSERT stays customer-only, DELETE stays admin-only.
drop policy if exists "orders_select_own_or_admin" on public.boat_orders;
drop policy if exists "orders_update_own_or_admin" on public.boat_orders;
drop policy if exists "boat_orders_select_all_admin" on public.boat_orders;
drop policy if exists "boat_orders_update_admin" on public.boat_orders;
create policy "orders_select_own_or_admin_or_manager" on public.boat_orders
  for select using (auth.uid() = "userId" or public.is_admin_or_manager());
create policy "orders_update_own_or_admin_or_manager" on public.boat_orders
  for update using (auth.uid() = "userId" or public.is_admin_or_manager())
  with check (auth.uid() = "userId" or public.is_admin_or_manager());

-- ===== dashboard_payments =====
-- Managers can read payments so the Boat Progress payment gate can display the
-- right step. Writes stay admin-only: paymentStep and remainingBalance are only
-- advanced by the admin, so the manager cannot self-unlock the 40%/75% gates.
drop policy if exists "payments_select_own_or_admin" on public.dashboard_payments;
drop policy if exists "dashboard_payments_select_admin" on public.dashboard_payments;
create policy "payments_select_own_or_admin_or_manager" on public.dashboard_payments
  for select using (auth.uid() = "userId" or public.is_admin_or_manager());

-- ===== project_workers =====
-- Managers assign and release workers. Customers keep read access to the
-- assignments on their own order only.
drop policy if exists "workers_select_own_order_or_admin" on public.project_workers;
drop policy if exists "workers_admin_insert" on public.project_workers;
drop policy if exists "workers_admin_update" on public.project_workers;
drop policy if exists "workers_admin_delete" on public.project_workers;
drop policy if exists "project_workers_select_all" on public.project_workers;
drop policy if exists "project_workers_insert_admin" on public.project_workers;
drop policy if exists "project_workers_update_admin" on public.project_workers;
drop policy if exists "project_workers_delete_admin" on public.project_workers;
create policy "workers_select_own_order_or_admin_or_manager" on public.project_workers
  for select using (
    public.is_admin_or_manager() or exists (
      select 1 from public.boat_orders
      where "orderId" = project_workers."orderId"
      and ("userId" = auth.uid() or "customerEmail" = auth.email())
    )
  );
create policy "workers_insert_admin_or_manager" on public.project_workers
  for insert with check (public.is_admin_or_manager());
create policy "workers_update_admin_or_manager" on public.project_workers
  for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy "workers_delete_admin_or_manager" on public.project_workers
  for delete using (public.is_admin_or_manager());

-- ===== project_tasks =====
-- Managers run the task board. Customers keep read access to their own tasks.
drop policy if exists "tasks_select_own_order_or_admin" on public.project_tasks;
drop policy if exists "tasks_admin_insert" on public.project_tasks;
drop policy if exists "tasks_admin_update" on public.project_tasks;
drop policy if exists "tasks_admin_delete" on public.project_tasks;
drop policy if exists "project_tasks_select_all" on public.project_tasks;
drop policy if exists "project_tasks_insert_admin" on public.project_tasks;
drop policy if exists "project_tasks_update_admin" on public.project_tasks;
drop policy if exists "project_tasks_delete_admin" on public.project_tasks;
create policy "tasks_select_own_order_or_admin_or_manager" on public.project_tasks
  for select using (
    public.is_admin_or_manager() or exists (
      select 1 from public.boat_orders
      where "orderId" = project_tasks."orderId" and "userId" = auth.uid()
    )
  );
create policy "tasks_insert_admin_or_manager" on public.project_tasks
  for insert with check (public.is_admin_or_manager());
create policy "tasks_update_admin_or_manager" on public.project_tasks
  for update using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
create policy "tasks_delete_admin_or_manager" on public.project_tasks
  for delete using (public.is_admin_or_manager());

-- ===== inventory =====
-- Intentionally untouched. The manager does not get inventory write access:
-- restocking and BOM deductions stay with the admin. Existing policies are
-- inventory_select_all / inventory_admin_all / inventory_admin_update /
-- inventory_admin_delete.

-- ===== Seed the manager account =====
update public.profiles
set role = 'manager'
where lower(email) = 'manager@gmail.com';
