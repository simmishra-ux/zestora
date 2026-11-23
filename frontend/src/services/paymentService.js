import { api } from './api'

// Step 1: ask OUR server to start a payment for an order (the amount is taken from the order on the server).
export const createIntent = (orderId) => api('/payments/intents', { method: 'POST', body: { orderId } })

// Steps 2-3: send the payment details to the GATEWAY. In a real integration this call goes to Stripe/Razorpay
// straight from the browser, so card numbers never touch our own backend. Here it is a mock endpoint.
export const confirmPayment = (intent, method, details) =>
  api('/gateway/confirm', { method: 'POST', body: { intentId: intent.intentId, clientSecret: intent.clientSecret, method, ...details } })
