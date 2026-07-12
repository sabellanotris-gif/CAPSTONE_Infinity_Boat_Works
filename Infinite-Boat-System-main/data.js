import { supabase } from "./supabase.js";

const CACHE_TTL = 30000;
let ordersCache = null;
let paymentsCache = null;
let ordersCacheTime = 0;
let paymentsCacheTime = 0;

function isCacheValid(timestamp) {
  return timestamp > 0 && Date.now() - timestamp < CACHE_TTL;
}

export async function loadOrders() {
  if (ordersCache && isCacheValid(ordersCacheTime)) return ordersCache;
  const { data, error } = await supabase
    .from("boat_orders")
    .select("*")
    .order("createdAt", { ascending: false });
  if (error) {
    console.error("Failed to load orders:", error);
    return [];
  }
  ordersCache = data || [];
  ordersCacheTime = Date.now();
  return ordersCache;
}

export async function saveOrder(order) {
  const { data, error } = await supabase
    .from("boat_orders")
    .insert(order)
    .select();
  if (error) {
    console.error("Failed to save order:", error);
    return null;
  }
  if (ordersCache) ordersCache.unshift(data[0]);
  return data[0];
}

export async function updateOrder(orderId, updates) {
  const { error } = await supabase
    .from("boat_orders")
    .update(updates)
    .eq("orderId", orderId);
  if (error) {
    console.error("Failed to update order:", error);
    return false;
  }
  if (ordersCache) {
    const idx = ordersCache.findIndex(o => o.orderId === orderId);
    if (idx !== -1) Object.assign(ordersCache[idx], updates);
  }
  return true;
}

export async function replaceAllOrders(orders) {
  const { error } = await supabase
    .from("boat_orders")
    .upsert(orders, { onConflict: "orderId" });
  if (error) {
    console.error("Failed to replace orders:", error);
    return false;
  }
  ordersCache = orders;
  return true;
}

export function getCachedOrders() {
  return ordersCache || [];
}

export async function loadPayments() {
  if (paymentsCache && isCacheValid(paymentsCacheTime)) return paymentsCache;
  const { data, error } = await supabase
    .from("dashboard_payments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Failed to load payments:", error);
    return [];
  }
  paymentsCache = data || [];
  paymentsCacheTime = Date.now();
  return paymentsCache;
}

export async function savePayment(payment) {
  const { data, error } = await supabase
    .from("dashboard_payments")
    .insert(payment)
    .select();
  if (error) {
    console.error("Failed to save payment:", error);
    return null;
  }
  if (paymentsCache) paymentsCache.unshift(data[0]);
  return data[0];
}

export async function updatePayment(paymentId, updates) {
  const { error } = await supabase
    .from("dashboard_payments")
    .update(updates)
    .eq("id", paymentId);
  if (error) {
    console.error("Failed to update payment:", error);
    return false;
  }
  if (paymentsCache) {
    const idx = paymentsCache.findIndex(p => p.id === paymentId);
    if (idx !== -1) Object.assign(paymentsCache[idx], updates);
  }
  return true;
}

export function getCachedPayments() {
  return paymentsCache || [];
}

export async function updatePaymentByOrderId(orderId, updates) {
  const { error } = await supabase
    .from("dashboard_payments")
    .update(updates)
    .eq("orderId", orderId);
  if (error) {
    console.error("Failed to update payment:", error);
    return false;
  }
  if (paymentsCache) {
    paymentsCache.forEach(p => {
      if (p.orderId === orderId) Object.assign(p, updates);
    });
  }
  return true;
}
