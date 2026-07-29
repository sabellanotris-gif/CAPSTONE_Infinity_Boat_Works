-- Migration: Add deliveryInfo JSONB column to boat_orders
-- Run this in Supabase SQL Editor

ALTER TABLE public.boat_orders ADD COLUMN IF NOT EXISTS "deliveryInfo" JSONB DEFAULT '{}';

-- Backfill existing completed orders with basic delivery info
UPDATE public.boat_orders
SET "deliveryInfo" = jsonb_build_object(
    'deliveryStatus', 'Preparing for Delivery',
    'expectedDate', 'To be determined',
    'committedDeliveryDate', '',
    'actualDeliveryDate', '',
    'deliveryLocation', 'To be confirmed',
    'contactPerson', 'To be assigned',
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
