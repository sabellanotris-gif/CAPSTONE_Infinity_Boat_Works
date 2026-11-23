-- Migration: Add deliveryInfo JSONB column to boat_orders
-- Run this in Supabase SQL Editor

ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "deliveryInfo" JSONB DEFAULT '{}';

-- Backfill existing orders with neutral tracking defaults only.
-- Customer-input fields (location, contact, preferred date) stay blank so the
-- customer still has to fill them in the delivery confirmation form.
UPDATE public.boat_orders
SET "deliveryInfo" = jsonb_build_object(
    'deliveryStatus', 'Preparing for Delivery',
    'expectedDate', '',
    'committedDeliveryDate', '',
    'actualDeliveryDate', '',
    'deliveryLocation', '',
    'contactPerson', '',
    'seaTrialResults', 'Pending',
    'deliveryProgress', 0,
    'deliveryConfirmed', false,
    'delayDays', 0,
    'delayPenalty', 0,
    'delayPenaltyPercent', 0,
    'delayReason', '',
    'delayNotified', false,
    'deliveryNotes', ''
)
WHERE "deliveryInfo" IS NULL OR "deliveryInfo" = '{}';
