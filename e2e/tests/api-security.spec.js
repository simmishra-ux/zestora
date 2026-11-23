// Security and business-rule checks made directly against the API, the way an attacker (or a buggy client) would:
// skipping the UI completely. The server must say no even when the page would never have allowed the request.
import { expect, test } from '@playwright/test'
import { ADDRESS, PRODUCTS, adminSession, apiSignup, placeOrderViaApi } from './helpers.js'

const items = (productId, qty = 1) => [{ productId, qty }]
const orderBody = (productId, extra = {}) => ({ items: items(productId), address: ADDRESS, paymentMethod: 'cod', ...extra })

test.describe('API: who may do what', () => {
  test('everything private needs a login', async ({ request }) => {
    for (const [method, url] of [['get', '/api/orders'], ['get', '/api/auth/me'], ['get', '/api/addresses'], ['get', '/api/support/thread'],
                                  ['get', '/api/admin/stats'], ['post', '/api/payments/intents'], ['post', '/api/orders']]) {
      const res = await request[method](url)
      expect(res.status(), `${method.toUpperCase()} ${url}`).toBe(401)
    }
  })

  test('an ordinary customer is refused every admin endpoint', async ({ request }) => {
    const user = await apiSignup(request)
    for (const url of ['/api/admin/stats', '/api/admin/products', '/api/admin/orders', '/api/admin/coupons', '/api/admin/support/threads']) {
      expect((await request.get(url, { headers: user.auth })).status(), url).toBe(403)
    }
    const res = await request.post('/api/admin/products', { headers: user.auth, data: { title: 'x' } })
    expect(res.status()).toBe(403)
  })

  test('forged or tampered login tokens are rejected', async ({ request }) => {
    const user = await apiSignup(request)
    const [header, , signature] = user.token.split('.')
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const tampered = [header, b64({ sub: user.user.id, exp: 9999999999, admin: true }), signature].join('.') // payload changed, signature kept
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.user.id, exp: 9999999999 })}.` // the classic "alg: none" trick
    for (const token of [tampered, unsigned, 'garbage', `${user.token}x`]) {
      expect((await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401)
    }
    expect((await request.get('/api/auth/me', { headers: user.auth })).status()).toBe(200) // the real one still works
  })

  test("one customer cannot read, change, cancel, delete or pay for another customer's things", async ({ request }) => {
    const alice = await apiSignup(request, 'Alice')
    const mallory = await apiSignup(request, 'Mallory')
    const order = await placeOrderViaApi(request, alice, { productId: PRODUCTS.shirt.id, method: 'upi' })
    const [address] = await (await request.post('/api/addresses', { headers: alice.auth, data: { label: 'Home', ...ADDRESS } })).json()
    const thread = await (await request.post('/api/support/messages', { headers: alice.auth, data: { text: 'talk to a person' } })).json()

    for (const [what, res] of [
      ['read order', await request.get(`/api/orders/${order.id}`, { headers: mallory.auth })],
      ['cancel order', await request.post(`/api/orders/${order.id}/cancel`, { headers: mallory.auth })],
      ['delete order', await request.delete(`/api/orders/${order.id}`, { headers: mallory.auth })],
      ['pay for order', await request.post('/api/payments/intents', { headers: mallory.auth, data: { orderId: order.id } })],
      ['edit address', await request.put(`/api/addresses/${address.id}`, { headers: mallory.auth, data: { label: 'Home', ...ADDRESS } })],
      ['delete address', await request.delete(`/api/addresses/${address.id}`, { headers: mallory.auth })],
    ]) {
      expect(res.status(), what).toBe(404) // "not found", so it does not even confirm the thing exists
    }
    const mine = await (await request.get('/api/support/thread', { headers: mallory.auth })).json()
    expect(mine).toBeNull() // Mallory has no conversation, and cannot see Alice's ticket
    expect(thread.id).toMatch(/^ZT\d{6}$/)
    expect((await request.get('/api/orders', { headers: mallory.auth }).then((r) => r.json()))).toEqual([]) // lists are filtered too
  })
})

test.describe('API: the server never trusts the browser', () => {
  test('prices and totals sent by the client are ignored', async ({ request }) => {
    const user = await apiSignup(request)
    const res = await request.post('/api/orders', {
      headers: user.auth,
      data: orderBody(PRODUCTS.iphone.id, { price: 1, total: 1, subtotal: 1, totals: { total: 1 }, items: [{ productId: PRODUCTS.iphone.id, qty: 1, price: 1 }] }),
    })
    expect(res.status()).toBe(201)
    const order = await res.json()
    expect(order.totals.subtotal).toBe(PRODUCTS.iphone.price) // the server's price, not the ₹1 we claimed
    expect(order.items[0].price).toBe(PRODUCTS.iphone.price)
  })

  test('coupon rules are enforced again at order time', async ({ request }) => {
    const user = await apiSignup(request)
    const upiOnly = await request.post('/api/orders', { headers: user.auth, data: orderBody(PRODUCTS.shirt.id, { couponCode: 'UPI5' }) }) // cod + UPI-only
    expect(upiOnly.status()).toBe(422)
    expect(await upiOnly.text()).toContain('UPI')
    expect((await request.post('/api/orders', { headers: user.auth, data: orderBody(PRODUCTS.shirt.id, { couponCode: 'NOSUCH' }) })).status()).toBe(422)
    const small = await request.post('/api/orders', { headers: user.auth, data: orderBody(PRODUCTS.cheap.id, { couponCode: 'FLAT200' }) }) // below the minimum
    expect(small.status()).toBe(422)

    const first = await request.post('/api/orders', { headers: user.auth, data: orderBody(PRODUCTS.shirt.id, { couponCode: 'WELCOME15' }) })
    expect(first.status()).toBe(201) // first order: allowed
    const again = await request.post('/api/orders', { headers: user.auth, data: orderBody(PRODUCTS.shirt.id, { couponCode: 'WELCOME15' }) })
    expect(again.status()).toBe(422) // "first order only"
  })

  test('you cannot buy more than is in stock, and stock never goes negative', async ({ request }) => {
    const user = await apiSignup(request)
    const before = await (await request.get('/api/products/p131')).json() // Apple MagSafe Battery: seeded with 1
    const res = await request.post('/api/orders', { headers: user.auth, data: { ...orderBody('p131'), items: items('p131', before.stock + 1) } })
    expect(res.status()).toBe(409)
    expect((await (await request.get('/api/products/p131')).json()).stock).toBe(before.stock) // untouched
    expect((await request.post('/api/orders', { headers: user.auth, data: { ...orderBody('p131'), items: items('p131', 0) } })).status()).toBe(422)
    expect((await request.post('/api/orders', { headers: user.auth, data: { ...orderBody('p131'), items: items('p131', 999) } })).status()).toBe(422)
  })

  test('a payment cannot be faked: forged webhooks and wrong secrets change nothing', async ({ request }) => {
    const user = await apiSignup(request)
    const order = await placeOrderViaApi(request, user, { productId: PRODUCTS.shirt.id, method: 'card' })
    const intent = await (await request.post('/api/payments/intents', { headers: user.auth, data: { orderId: order.id } })).json()

    const event = { id: 'evt_fake', type: 'payment.succeeded', intentId: intent.intentId, orderId: order.id, amount: order.totals.total }
    const forged = await request.post('/api/webhooks/payment', { data: event, headers: { 'X-Gateway-Signature': 'f'.repeat(64) } })
    expect(forged.status()).toBe(400) // a made-up signature
    const noSignature = await request.post('/api/webhooks/payment', { data: event })
    expect(noSignature.status()).toBe(400)
    const wrongSecret = await request.post('/api/gateway/confirm', { data: { intentId: intent.intentId, clientSecret: 'guess', method: 'card', cardNumber: '4242424242424242', expiry: '12/39', cvv: '123' } })
    expect(wrongSecret.status()).toBe(404)

    const after = await (await request.get(`/api/orders/${order.id}`, { headers: user.auth })).json()
    expect(after.paymentStatus).toBe('pending') // still unpaid after every attempt
    expect(after.paidAt).toBeNull()
  })

  test('inputs are validated: weak passwords, bad emails and oversized text', async ({ request }) => {
    const post = (path, data, headers) => request.post(path, { data, headers })
    expect((await post('/api/auth/signup', { name: 'A B', email: 'nope', password: 'longenough1' })).status()).toBe(422)
    expect((await post('/api/auth/signup', { name: 'A B', email: 'a@zestora-e2e.dev', password: 'short1' })).status()).toBe(422)
    expect((await post('/api/auth/signup', { name: 'A B', email: 'b@zestora-e2e.dev', password: 'onlyletters' })).status()).toBe(422)
    const user = await apiSignup(request)
    expect((await post('/api/support/messages', { text: 'x'.repeat(1001) }, user.auth)).status()).toBe(422)
    expect((await post('/api/addresses', { ...ADDRESS, pincode: '12' }, user.auth)).status()).toBe(422)
  })

  test('chat spam is slowed down', async ({ request }) => {
    const user = await apiSignup(request)
    const statuses = []
    for (let i = 0; i < 17; i++) statuses.push((await request.post('/api/support/messages', { headers: user.auth, data: { text: 'hello' } })).status())
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBeTruthy()
    expect(statuses).toContain(429)
  })

  test('hidden products cannot be bought', async ({ request }) => {
    const admin = await adminSession(request)
    const user = await apiSignup(request)
    const p = await (await request.get('/api/products/p255')).json() // Red Onions
    const body = { title: p.title, brand: p.brand, category: p.category, price: p.price, mrp: p.mrp, stock: p.stock, emoji: p.emoji, hue: p.hue, description: p.description }
    await request.put('/api/admin/products/p255', { headers: admin.auth, data: { ...body, active: false } })
    const res = await request.post('/api/orders', { headers: user.auth, data: orderBody('p255') })
    expect(res.status()).toBe(409)
    expect(await res.text()).toContain('no longer available')
    await request.put('/api/admin/products/p255', { headers: admin.auth, data: { ...body, active: true } }) // put it back
  })
})
