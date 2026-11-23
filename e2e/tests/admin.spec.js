import { expect, test } from '@playwright/test'
import { PRODUCTS, adminSession, apiSignup, getOrder, getProduct, loginWithToken, placeOrderViaApi, rupees } from './helpers.js'

test.describe('Admin dashboard', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginWithToken(page, (await adminSession(request)).token)
  })

  test('the overview shows live numbers', async ({ page, request }) => {
    const admin = await adminSession(request)
    const buyer = await apiSignup(request)
    await placeOrderViaApi(request, buyer, { productId: PRODUCTS.shirt.id })
    const stats = await (await request.get('/api/admin/stats', { headers: admin.auth })).json()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1, name: 'Store dashboard' })).toBeVisible()
    await expect(page.locator('.stat', { hasText: 'Revenue' })).toContainText(rupees(stats.revenue))
    await expect(page.locator('.stat', { hasText: 'Open tickets' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Best sellers' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Low stock/ })).toBeVisible()
    await expect(page.locator('.mini-list', { hasText: PRODUCTS.lastUnit.title }).first()).toBeVisible() // seeded with 1 unit left
  })

  test('inventory: edit the stock of a product right in the table', async ({ page, request }) => {
    await page.goto('/admin/products')
    await page.locator('.admin-toolbar').getByLabel('Search products').fill('Kiwi')
    const row = page.locator('tr', { hasText: 'Kiwi' }).first()
    await expect(row).toBeVisible()
    await row.getByLabel('Stock for Kiwi').fill('7')
    await row.getByLabel('Stock for Kiwi').press('Enter')
    await expect(page.locator('.toast', { hasText: 'Stock updated for Kiwi' })).toBeVisible()
    expect((await getProduct(request, 'p248')).stock).toBe(7)

    // 7 units is not "low" (5 or fewer), so the low-stock view must NOT list it...
    const lowOnly = page.locator('.admin-toolbar').getByLabel('Low stock only')
    await lowOnly.click()
    await expect(lowOnly).toBeChecked()
    await expect(page.locator('tr', { hasText: 'Kiwi' })).toHaveCount(0)
    await lowOnly.click()
    await expect(lowOnly).not.toBeChecked()

    // ...but once the stock drops to 3, it must.
    const kiwi = page.locator('tr', { hasText: 'Kiwi' }).first()
    await kiwi.getByLabel('Stock for Kiwi').fill('3')
    await kiwi.getByLabel('Stock for Kiwi').press('Enter')
    await expect(page.locator('.toast', { hasText: 'Stock updated for Kiwi' }).last()).toBeVisible()
    await lowOnly.click()
    await expect(page.locator('tr', { hasText: 'Kiwi' })).toBeVisible()
    expect((await getProduct(request, 'p248')).stock).toBe(3)
  })

  test('hiding a product removes it from the shop; showing it brings it back', async ({ page, request }) => {
    await page.goto('/admin/products')
    await page.locator('.admin-toolbar').getByLabel('Search products').fill('Tissue Paper')
    const toggle = page.getByRole('switch', { name: 'Tissue Paper Box visible in shop' })
    await toggle.click()
    await expect(page.locator('.toast', { hasText: 'is now hidden' })).toBeVisible()
    expect((await request.get('/api/products/p259')).status()).toBe(404)
    await page.goto('/products?q=tissue')
    await expect(page.getByRole('heading', { name: 'No products match' })).toBeVisible()

    await page.goto('/admin/products')
    await page.locator('.admin-toolbar').getByLabel('Search products').fill('Tissue Paper')
    await page.getByRole('switch', { name: 'Tissue Paper Box visible in shop' }).click()
    await expect(page.locator('.toast', { hasText: 'visible again' })).toBeVisible()
    expect((await request.get('/api/products/p259')).status()).toBe(200)
  })

  test('create a product: it appears in the shop, marked new', async ({ page, request }) => {
    await page.goto('/admin/products')
    await page.getByRole('button', { name: '+ New product' }).click()
    const dialog = page.getByRole('dialog', { name: 'Product form' })

    await dialog.getByLabel('Product name').fill('E2E Test Gadget')
    await dialog.getByLabel('Brand').fill('Acme')
    await dialog.getByLabel('Selling price (₹)').fill('1500')
    await dialog.getByLabel('MRP (₹)').fill('1000') // price above MRP: refused
    await dialog.getByLabel('Stock').fill('3')
    await dialog.getByLabel('Description').fill('A gadget created by the end-to-end test suite.')
    await dialog.getByRole('button', { name: 'Save product' }).click()
    await expect(dialog.getByText('Price can’t exceed MRP.')).toBeVisible()

    await dialog.getByLabel('Selling price (₹)').fill('800')
    await dialog.getByRole('button', { name: 'Save product' }).click()
    await expect(page.locator('.toast', { hasText: 'Product created' })).toBeVisible()

    const found = await (await request.get('/api/products?q=E2E Test Gadget')).json()
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ price: 800, mrp: 1000, discount: 20, stock: 3, reviews: 0, active: true })
    await page.goto('/products?q=E2E Test Gadget')
    await expect(page.locator('.card', { hasText: 'E2E Test Gadget' }).locator('.rating__pill--new')).toHaveText('New')
  })

  test('orders: moving an order to "shipped" is reflected for the customer, who can then no longer cancel', async ({ page, request, browser }) => {
    const buyer = await apiSignup(request)
    const order = await placeOrderViaApi(request, buyer, { productId: PRODUCTS.shirt.id })

    await page.goto('/admin/orders')
    const card = page.locator('.aorder', { hasText: order.id })
    await expect(card).toContainText(buyer.email)
    await card.getByLabel(`Status of order ${order.id}`).selectOption('shipped')
    await expect(page.locator('.toast', { hasText: `Order #${order.id} → Shipped` })).toBeVisible()
    await page.getByRole('tab', { name: /^Shipped/ }).click()
    await expect(page.locator('.aorder', { hasText: order.id })).toBeVisible()

    expect((await getOrder(request, buyer, order.id)).adminStatus).toBe('shipped')
    const cancel = await request.post(`/api/orders/${order.id}/cancel`, { headers: buyer.auth })
    expect(cancel.status()).toBe(409) // too late to cancel

    const customerPage = await (await browser.newContext()).newPage() // the customer's own browser
    await loginWithToken(customerPage, buyer.token)
    await customerPage.goto(`/orders/${order.id}`)
    await expect(customerPage.locator('.tracker .current')).toContainText('Shipped')
    await expect(customerPage.getByRole('button', { name: 'Cancel order' })).toHaveCount(0)
  })

  test('coupons: create one, shoppers see it straight away, deactivating hides it', async ({ page, request }) => {
    await page.goto('/admin/coupons')
    await page.getByRole('button', { name: '+ New coupon' }).click()
    const dialog = page.getByRole('dialog', { name: 'Coupon form' })
    await dialog.getByLabel('Code').fill('E2E50')
    await dialog.getByLabel('Title').fill('E2E half price')
    await dialog.getByLabel('Percent off').fill('150')
    await dialog.getByRole('button', { name: 'Save coupon' }).click()
    await expect(dialog.getByText('Max 100%.')).toBeVisible() // validated

    await dialog.getByLabel('Percent off').fill('50')
    await dialog.getByLabel('Max discount ₹ (optional)').fill('500')
    await dialog.getByRole('button', { name: 'Save coupon' }).click()
    await expect(page.locator('.toast', { hasText: 'Coupon created' })).toBeVisible()
    await expect(page.locator('tr', { hasText: 'E2E50' })).toContainText('50% off (max ₹500)')

    const offers = async () => {
      const res = await request.post('/api/coupons/offers', { data: { items: [{ productId: PRODUCTS.shirt.id, qty: 1 }] } })
      return (await res.json()).offers.map((o) => o.code)
    }
    expect(await offers()).toContain('E2E50') // live for shoppers immediately

    await page.getByRole('switch', { name: 'E2E50 active' }).click()
    await expect(page.locator('.toast', { hasText: 'E2E50 deactivated' })).toBeVisible()
    expect(await offers()).not.toContain('E2E50')
  })
})
