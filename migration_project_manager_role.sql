-- Project Manager Role Migration
-- Creates manager helper functions, updates RLS policies to include managers,
-- and seeds the fixed manager account

-- Helper functions
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

-- RLS: boat_orders - SELECT + UPDATE for admin or manager; INSERT/DELETE remain admin-only
drop policy if exists boat_orders_select_all_admin on public.boat_orders;
create policy boat_orders_select_all_admin on public.boat_orders
  for select using (public.is_admin_or_manager());

drop policy if exists boat_orders_update_admin on public.boat_orders;
create policy boat_orders_update_admin on public.boat_orders
  for update using (public.is_admin_or_manager());

-- RLS: project_workers - full CRUD for admin or manager
drop policy if exists project_workers_select_all on public.project_workers;
create policy project_workers_select_all on public.project_workers
  for select using (true);

drop policy if exists project_workers_insert_admin on public.project_workers;
create policy project_workers_insert_admin on public.project_workers
  for insert with check (public.is_admin_or_manager());

drop policy if exists project_workers_update_admin on public.project_workers;
create policy project_workers_update_admin on public.project_workers
  for update using (public.is_admin_or_manager());

drop policy if exists project_workers_delete_admin on public.project_workers;
create policy project_workers_delete_admin on public.project_workers
  for delete using (public.is_admin_or_manager());

-- RLS: project_tasks - full CRUD for admin or manager
drop policy if exists project_tasks_select_all on public.project_tasks;
create policy project_tasks_select_all on public.project_tasks
  for select using (true);

drop policy if exists project_tasks_insert_admin on public.project_tasks;
create policy project_tasks_insert_admin on public.project_tasks
  for insert with check (public.is_admin_or_manager());

drop policy if exists project_tasks_update_admin on public.project_tasks;
create policy project_tasks_update_admin on public.project_tasks
  for update using (public.is_admin_or_manager());

drop policy if exists project_tasks_delete_admin on public.project_tasks;
create policy project_tasks_delete_admin on public.project_tasks
  for delete using (public.is_admin_or_manager());

-- RLS: dashboard_payments - SELECT for admin or manager
drop policy if exists dashboard_payments_select_admin on public.dashboard_payments;
create policy dashboard_payments_select_admin on public.dashboard_payments
  for select using (public.is_admin_or_manager());

-- RLS: profiles - SELECT for admin or manager
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (public.is_admin_or_manager());

-- Seed fixed PM account
update public.profiles
set role = 'manager'
where lower(email) = 'manager@gmail.com';
