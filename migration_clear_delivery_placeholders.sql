-- CLEANUP: Remove the old placeholder values from deliveryInfo so the customer
-- still has to fill in their own delivery location and contact person.
--
-- Run this in the Supabase SQL Editor after migration_delivery_info.sql was
-- already applied to a project. Safe to re-run.

UPDATE public.boat_orders
SET "deliveryInfo" = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set("deliveryInfo", '{expectedDate}', '""'::jsonb, true),
            '{deliveryLocation}', '""'::jsonb, true),
          '{contactPerson}', '""'::jsonb, true),
        '{confirmLocation}', '""'::jsonb, true),
      '{confirmContact}', '""'::jsonb, true),
    "updatedAt" = NOW()
WHERE COALESCE("deliveryInfo"->>'expectedDate', '') = 'To be determined'
   OR COALESCE("deliveryInfo"->>'deliveryLocation', '') IN ('To be confirmed', 'To be assigned')
   OR COALESCE("deliveryInfo"->>'contactPerson', '') IN ('To be confirmed', 'To be assigned')
   OR COALESCE("deliveryInfo"->>'confirmLocation', '') IN ('To be confirmed', 'To be assigned')
   OR COALESCE("deliveryInfo"->>'confirmContact', '') IN ('To be confirmed', 'To be assigned');
