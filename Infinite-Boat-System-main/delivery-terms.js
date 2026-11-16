// ============ DELIVERY TERMS (shared constants) ============
// Single source of truth for the delivery terms the customer signs and
// the staff-facing penalty reference. Imported by both the admin/manager
// pages (delivery-shared.js) and the customer project page (home.js).

export const DELIVERY_TERMS = [
  "The committed delivery date is honored when the order is fully paid and the sea trial is Passed (or Conditional, accepted in writing).",
  "If the delivery passes the committed date, the following is deducted from the remaining balance: 1% of the boat price for 1–7 days late, 2% for 8–14 days, 5% for 15–30 days, and 8% for more than 30 days late.",
  "Sea trial results must be Passed (or Conditional, accepted in writing) before the boat is released for delivery.",
  "An authorized customer representative must receive the vessel, complete the check-out, and sign the delivery acknowledgement at handover.",
  "The warranty period starts upon confirmed delivery, per your order's warranty terms.",
  "Any complaint about the delivery condition must be raised at, or within 7 days of, acceptance.",
  "Delivery is made per the method for your boat model (flatbed trailer or sea tow), as stated in the order.",
];

export const PENALTY_TIERS = [
  { label: "1–7 days late", percent: 1 },
  { label: "8–14 days late", percent: 2 },
  { label: "15–30 days late", percent: 5 },
  { label: "Over 30 days late", percent: 8 },
];

export const DELIVERY_PENALTY_RULE = "1% (1–7 days late) · 2% (8–14 days) · 5% (15–30 days) · 8% (over 30 days) of the boat price, deducted from the remaining balance.";
