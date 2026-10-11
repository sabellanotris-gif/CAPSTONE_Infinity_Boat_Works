-- ============================================================
-- Field-level guard for boat_orders and dashboard_payments
-- ============================================================
-- Closes the mass-assignment hole at the DATABASE layer so it also covers
-- writes made directly through the Supabase JS client (which is how most
-- customer pages persist data), not just the Express API.
--
-- Applies to every writer that is NOT an admin, a project manager, or the
-- server's service-role key (service-role writes are trusted server logic).
-- deliveryInfo is stricter still: admin / service-role only (managers excluded).
-- Role checks are inlined against public.profiles so this migration does not
-- depend on is_admin()/is_admin_or_manager() existing.
--
-- Run once in the Supabase SQL Editor.

-- ----------------------------- boat_orders -----------------------------
CREATE OR REPLACE FUNCTION public.guard_boat_order_writes()
RETURNS TRIGGER AS $$
DECLARE
  actor_role text;
  trusted boolean;
  delivery_trusted boolean;
  allowed_statuses text[] := ARRAY[
    'Pending', 'Pending Signing', 'Under Review',
    'Cancellation Requested', 'Cancelled'
  ];
BEGIN
  -- Trusted when the JWT role is service_role, or the caller's profile role
  -- is admin/manager. Service role has no auth.uid() so it must be checked
  -- separately (Express admin operations run through it).
  actor_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  trusted := (auth.role() = 'service_role') OR (actor_role IN ('admin', 'manager'));
  -- Delivery details are admin-only: managers are intentionally excluded here
  -- even though they are trusted for every other staff column.
  delivery_trusted := (auth.role() = 'service_role') OR (actor_role = 'admin');

  IF TG_OP = 'INSERT' THEN
    IF NOT trusted THEN
      IF NOT (NEW.status = ANY(allowed_statuses)) THEN
        NEW.status := 'Pending';
      END IF;
      IF NEW.progress IS NULL OR NEW.progress NOT IN (0, 5) THEN
        NEW.progress := 0;
      END IF;
      NEW."paymentStep" := 0;
      NEW."paymentHistory" := '[]'::jsonb;
      NEW."milestones" := '[]'::jsonb;
      NEW."activityLog" := '[]'::jsonb;
      NEW."progressPhotos" := '[]'::jsonb;
      NEW."budgetInfo" := '{}'::jsonb;
      NEW."documents" := '[]'::jsonb;
      NEW."projectCompletedDate" := NULL;
      NEW."materialsDeducted" := false;
    END IF;
    -- Delivery details may never be set directly on insert by a non-admin.
    IF NOT delivery_trusted THEN
      NEW."deliveryInfo" := '{}'::jsonb;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT trusted THEN
    -- UPDATE: force every server-controlled column back to its stored value.
    NEW."paymentHistory" := OLD."paymentHistory";
    NEW."milestones" := OLD."milestones";
    NEW."activityLog" := OLD."activityLog";
    NEW."progressPhotos" := OLD."progressPhotos";
    NEW."budgetInfo" := OLD."budgetInfo";
    NEW."documents" := OLD."documents";
    NEW."projectCompletedDate" := OLD."projectCompletedDate";
    NEW."materialsDeducted" := OLD."materialsDeducted";
    NEW."paymentStep" := OLD."paymentStep";
    NEW."userId" := OLD."userId";
    NEW."createdAt" := OLD."createdAt";

    -- Lifecycle status may only move within the customer-allowed set.
    IF NOT (NEW.status = ANY(allowed_statuses)) THEN
      NEW.status := OLD.status;
    END IF;

    -- Progress is customer-visible only at the schedule steps (0 or 5).
    IF NEW.progress IS NULL OR NEW.progress NOT IN (0, 5) THEN
      NEW.progress := OLD.progress;
    END IF;
  END IF;

  -- Delivery details are admin-only for every write path, including managers.
  IF NOT delivery_trusted THEN
    NEW."deliveryInfo" := OLD."deliveryInfo";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS boat_order_field_guard ON public.boat_orders;
CREATE TRIGGER boat_order_field_guard
  BEFORE INSERT OR UPDATE ON public.boat_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_boat_order_writes();

-- ------------------------- dashboard_payments --------------------------
CREATE OR REPLACE FUNCTION public.guard_payment_insert()
RETURNS TRIGGER AS $$
DECLARE
  actor_role text;
  trusted boolean;
BEGIN
  actor_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  trusted := (auth.role() = 'service_role') OR (actor_role IN ('admin', 'manager'));
  IF trusted THEN
    RETURN NEW;
  END IF;

  -- A customer-submitted payment always starts life as Pending; only an admin
  -- may set Approved/Rejected (separate UPDATE path gated by RLS).
  NEW.status := 'Pending';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS payment_status_guard ON public.dashboard_payments;
CREATE TRIGGER payment_status_guard
  BEFORE INSERT ON public.dashboard_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_insert();
