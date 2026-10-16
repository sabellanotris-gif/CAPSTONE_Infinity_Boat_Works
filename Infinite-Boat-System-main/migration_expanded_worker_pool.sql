-- ============================================
-- MIGRATION: Expanded Worker Pool
-- Adds the extra workers needed to staff the largest boat (2680 Passenger
-- Boat = 21 slots at once) across the 8 specialties. Idempotent: existing
-- workers (matched by name) are left untouched.
--
-- Run once in the Supabase SQL Editor.
-- After running, execute `node create-worker-accounts.mjs` to create the
-- login accounts for the newly added workers (password: worker12345).
-- ============================================

WITH new_workers("name", "specialty") AS (
  VALUES
    -- Builder (up to 6 for the 2680)
    ('Rogelio Santos', 'Builder'),
    ('Efren Del Rosario', 'Builder'),
    ('Nestor Aquino', 'Builder'),
    ('Danilo Ramos', 'Builder'),
    -- Welder (up to 3)
    ('Rodel Garcia', 'Welder'),
    -- Fiberglass Specialist (up to 5)
    ('Alfredo Mendoza', 'Fiberglass Specialist'),
    ('Ernesto Castillo', 'Fiberglass Specialist'),
    ('Benjamin Ocampo', 'Fiberglass Specialist'),
    -- Mechanic (up to 2)
    ('Leonardo Cruz', 'Mechanic'),
    ('Mario Fernandez', 'Mechanic'),
    -- Quality Inspector (up to 1)
    ('Engr. Sofia Ramirez', 'Quality Inspector')
)
INSERT INTO public.workers ("name", "specialty", "status")
SELECT nw."name", nw."specialty", 'Active'
FROM new_workers nw
WHERE NOT EXISTS (
  SELECT 1 FROM public.workers w WHERE w."name" = nw."name"
);
