-- Add ratingInfo JSONB column to boat_orders for customer ratings/reviews
ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "ratingInfo" JSONB DEFAULT '{}'::jsonb;
