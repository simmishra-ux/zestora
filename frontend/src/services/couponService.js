import { api } from './api'

// Evaluates every live offer against this cart (+ chosen payment method). The server does all the maths.
export const getOffers = (entries, paymentMethod) =>
  api('/coupons/offers', {
    method: 'POST',
    body: { items: entries.map((e) => ({ productId: e.id, qty: e.qty })), paymentMethod: paymentMethod || null },
  })
