/* =========================================================
   SHARED SEARCH HELPERS — frontend only, no side effects.
   Used by every searchable page and by global search so the
   same query behaves the same way everywhere.
   ========================================================= */

/** Lowercase, strip accents, trim. Safe for any value. */
export function normalize(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Split a query into lowercase terms. Empty query -> []. */
export function toTerms(query) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/** Flatten any mix of strings / arrays / plain objects into one searchable string. */
export function flatText(...values) {
  const out = [];
  const add = (value) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(add);
      return;
    }
    out.push(String(value));
  };
  values.forEach(add);
  return out.join(" ");
}

/**
 * Multi-term AND matching. Every term must appear somewhere in the haystack.
 * An empty query matches everything.
 */
export function matchesQuery(haystack, query) {
  const terms = toTerms(query);
  if (!terms.length) return true;
  const hay = normalize(haystack);
  return terms.every((term) => hay.includes(term));
}

/** All text that should be searchable on an order. */
export function searchableOrderText(order) {
  if (!order) return "";
  const di = order.deliveryInfo || {};
  const rating = order.ratingInfo || {};
  const parts = [
    order.boatName,
    order.customerName,
    order.orderId,
    order.customerEmail,
    order.customerPhone,
    order.customerAddress,
    order.boatType,
    order.buildType,
    order.status,
    order.orderPhase,
    order.notes,
    order.createdAt,
    di.customerName,
    di.customerEmail,
    di.customerPhone,
    di.deliveryLocation,
    di.confirmLocation,
    di.contactPerson,
    di.confirmContact,
    di.confirmName,
    di.acknowledgmentName,
    di.deliveryNotes,
    di.delayReason,
    di.seaTrialResults,
    di.deliveryStatus,
    rating.customerName,
    rating.comment,
    rating.review,
  ];
  if (Array.isArray(di.snagList)) {
    di.snagList.forEach((snag) => {
      if (!snag) return;
      parts.push(snag.title, snag.note, snag.notes, snag.description, snag.status);
    });
  }
  if (Array.isArray(di.checklist)) {
    di.checklist.forEach((item) => {
      parts.push(typeof item === "string" ? item : item && (item.label || item.name || item.title));
    });
  } else if (di.checklist && typeof di.checklist === "object") {
    Object.values(di.checklist).forEach((item) => {
      parts.push(typeof item === "string" ? item : item && (item.label || item.name || item.title));
    });
  }
  return flatText(...parts);
}

/** All text that should be searchable on a customer row (profile + every order). */
export function searchableCustomerText(customer) {
  if (!customer) return "";
  const orders = Array.isArray(customer.orders) ? customer.orders.map(searchableOrderText) : [];
  return flatText(
    customer.name,
    customer.email,
    customer.phone,
    customer.profile && customer.profile.name,
    customer.profile && customer.profile.email,
    customer.profile && customer.profile.phone,
    customer.orderCount,
    ...orders
  );
}

/** Read ?q= from the current URL. Always returns a string. */
export function queryFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("q") || "";
  } catch (e) {
    return "";
  }
}

/** Replace ?q= in the URL without adding a history entry (best effort). */
export function setUrlQuery(query) {
  try {
    const url = new URL(window.location.href);
    const value = String(query || "").trim();
    if (value) url.searchParams.set("q", value);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch (e) {
    /* ignore */
  }
}
