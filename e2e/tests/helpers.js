// Shared helpers. Setup that is NOT what a test is about (creating a user, an order...) goes through the API,
// which is fast and reliable; the behaviour a test IS about is always driven through the real UI.
import { expect } from '@playwright/test'

export const PASSWORD = 'Passw0rd!1'
export const ADMIN = { name: 'Store Admin', email: 'admin@zestora.dev', password: PASSWORD }
export const ADDRESS = { name: 'Asha Verma', phone: '9876543210', line1: '12 MG Road, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038' }

// Known products from the seeded catalog (backend/seed/products.json).
export const PRODUCTS = {
  iphone: { id: 'p103', title: 'iPhone 13 Pro', price: 91299 },
  shirt: { id: 'p141', title: 'Man Plaid Shirt', price: 2899 }, // plenty in stock, free delivery
  cheap: { id: 'p239', title: 'Cucumber', price: 119 }, // under the free-delivery threshold, so a delivery fee applies
  lastUnit: { id: 'p128', title: 'Apple Airpower Wireless Charger' }, // seeded with exactly 1 in stock
  soldOut: { id: 'p112', title: 'Samsung Galaxy S8' }, // seeded with 0 in stock
}

let counter = 0
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now().toString(36)}${counter++}@zestora-e2e.dev`

export async function apiSignup(request, name = 'Asha Verma') {
  const email = uniqueEmail()
  const res = await request.post('/api/auth/signup', { data: { name, email, password: PASSWORD } })
  expect(res.status(), await res.text()).toBe(201)
  const { token, user } = await res.json()
  return { token, user, email, auth: { Authorization: `Bearer ${token}` } }
}

// The admin account is created by signing up with the admin email (see ADMIN_EMAILS); later runs just log in.
export async function adminSession(request) {
  let res = await request.post('/api/auth/signup', { data: ADMIN })
  if (res.status() === 409) res = await request.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })
  expect(res.ok(), await res.text()).toBeTruthy()
  const { token } = await res.json()
  return { token, auth: { Authorization: `Bearer ${token}` } }
}

// "Log in" a browser page by planting the token where the app keeps it, before any page script runs.
export async function loginWithToken(page, token) {
  await page.addInitScript((t) => localStorage.setItem('zestora.token', t), token)
}

export async function getProduct(request, id) {
  const res = await request.get(`/api/products/${id}`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

export async function placeOrderViaApi(request, session, { productId = PRODUCTS.cheap.id, qty = 1, method = 'cod', coupon = null } = {}) {
  const res = await request.post('/api/orders', {
    headers: session.auth,
    data: { items: [{ productId, qty }], address: ADDRESS, paymentMethod: method, couponCode: coupon, email: session.email },
  })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

export async function getOrder(request, session, id) {
  const res = await request.get(`/api/orders/${id}`, { headers: session.auth })
  expect(res.ok(), await res.text()).toBeTruthy()
  return res.json()
}

// Rupee amounts as the UI prints them: 91299 -> "₹91,299"
export const rupees = (n) => `₹${n.toLocaleString('en-IN')}`

export async function fillAddress(page, a = ADDRESS) {
  await page.getByLabel('Full name', { exact: true }).fill(a.name)
  await page.getByLabel('Mobile number').fill(a.phone)
  await page.getByLabel('Address', { exact: true }).fill(a.line1)
  await page.getByLabel('City', { exact: true }).fill(a.city)
  await page.getByLabel('State', { exact: true }).fill(a.state)
  await page.getByLabel('Pincode').fill(a.pincode)
}

// ---- UI flow helpers (each one is a step a real shopper takes) ----
export async function addToCart(page, productId) {
  await page.goto(`/products/${productId}`)
  await page.locator('.info').getByRole('button', { name: 'Add to cart' }).click() // the main product, not the "similar products" cards
  await expect(page.locator('.toast', { hasText: 'to cart' })).toBeVisible() // the cart is saved right after this toast
}

export async function saveAddress(request, session, extra = {}) {
  const res = await request.post('/api/addresses', { headers: session.auth, data: { label: 'Home', ...ADDRESS, ...extra } })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

// Cart -> checkout -> (saved address) -> the payment step.
export async function goToPaymentStep(page) {
  await page.goto('/cart')
  await page.getByRole('button', { name: 'Proceed to checkout' }).click()
  await expect(page.getByRole('heading', { name: 'Delivery address' })).toBeVisible()
  await page.getByRole('button', { name: 'Deliver here' }).click()
  await expect(page.getByRole('heading', { name: 'Payment method' })).toBeVisible()
}

export const PAY = { upi: /^UPI/, card: /Credit \/ Debit card/, cod: /Cash on delivery/ }

export async function chooseAndReview(page, method) {
  await page.getByRole('radio', { name: method }).check()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByRole('heading', { name: 'Review your order' })).toBeVisible()
}

export const orderIdFromUrl = (page) => new URL(page.url()).pathname.split('/').pop()

// Dev inbox: the confirmation email as the customer would receive it.
export async function emailFor(request, orderId) {
  const res = await request.get(`/api/dev/inbox/${orderId}`)
  return { ok: res.ok(), html: res.ok() ? await res.text() : '' }
}

// ---- Voice search ----
// Tests have no microphone, so we plant a FAKE speech engine in the page before the app loads, and then "speak" by calling
// window.__speech.interim("iph") / final("iphone 13 pro") / fail("not-allowed") / silence() from the test.
// With { supported: false } the browser has no speech recognition at all (like Firefox).
export async function mockSpeech(page, { supported = true } = {}) {
  await page.addInitScript((isSupported) => {
    if (!isSupported) {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })
      return
    }
    const control = { starts: 0, instance: null, denied: false }
    class FakeRecognition {
      constructor() {
        control.instance = this
        this.aborted = false
      }
      start() {
        control.starts += 1
        if (control.denied) {
          setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.() }, 0)
          return
        }
        setTimeout(() => this.onstart?.(), 0)
      }
      stop() { this.onend?.() }
      abort() {
        this.aborted = true
        this.onerror?.({ error: 'aborted' })
        this.onend?.()
      }
    }
    const emit = (text, isFinal) => {
      const result = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal })
      control.instance.onresult?.({ results: [result], resultIndex: 0 })
    }
    window.SpeechRecognition = FakeRecognition
    window.webkitSpeechRecognition = FakeRecognition
    window.__speech = {
      control,
      interim: (text) => emit(text, false),
      final: (text) => emit(text, true),
      fail: (error) => { control.instance.onerror?.({ error }); control.instance.onend?.() },
      silence: () => control.instance.onend?.(),
    }
  }, supported)
}
