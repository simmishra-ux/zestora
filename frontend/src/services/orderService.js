import { api } from './api'

// Timeline used by the tracking UI. Status is derived from the order's age so the demo "moves" on its own.
// (A real system would store status changes written by warehouse/courier events.)
export const ORDER_STEPS = [
  { key: 'placed', label: 'Order placed', afterMs: 0 },
  { key: 'packed', label: 'Packed', afterMs: 30_000 },
  { key: 'shipped', label: 'Shipped', afterMs: 90_000 },
  { key: 'out', label: 'Out for delivery', afterMs: 180_000 },
  { key: 'delivered', label: 'Delivered', afterMs: 300_000 },
]

export const isUnpaid = (order) => order.paymentStatus === 'pending' || order.paymentStatus === 'failed'

export const PAYMENT_LABELS = {
  paid: 'Paid', cod: 'Cash on delivery', pending: 'Payment pending', failed: 'Payment failed',
  refunded: 'Refunded', expired: 'Payment not completed', void: 'Payment not completed',
}

export function getStatusIndex(order) {
  if (order.cancelled) return -1
  if (isUnpaid(order)) return 0 // an unpaid order is not packed or shipped
  // An admin's explicit status wins over the age-based simulation.
  const forced = ORDER_STEPS.findIndex((s) => s.key === order.adminStatus)
  if (forced !== -1) return forced
  const elapsed = Date.now() - new Date(order.paidAt ?? order.createdAt).getTime() // the clock starts when the money arrives
  let idx = 0
  ORDER_STEPS.forEach((s, i) => elapsed >= s.afterMs && (idx = i))
  return idx
}

export const listOrders = () => api('/orders')
export const getOrder = (id) => api(`/orders/${encodeURIComponent(id)}`)
export const deleteOrder = (id) => api(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const bulkDeleteOrders = (ids) => api('/orders/bulk-delete', { method: 'POST', body: { ids } })

// Same rule as the server: only cancelled or delivered orders can be deleted.
export const isFinished = (order) => {
  const i = getStatusIndex(order)
  return i === -1 || i === ORDER_STEPS.length - 1
}
export const cancelOrder = (id) => api(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

// We send only ids + quantities. Prices and totals are calculated by the server (never trust the browser).
export const createOrder = ({ lines, address, paymentMethod, couponCode, email }) =>
  api('/orders', {
    method: 'POST',
    body: { items: lines.map((l) => ({ productId: l.product.id, qty: l.qty })), address, paymentMethod, couponCode: couponCode || null, email },
  })
