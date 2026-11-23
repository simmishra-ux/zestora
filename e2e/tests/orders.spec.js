import { expect, test } from '@playwright/test'
import { PRODUCTS, apiSignup, getOrder, getProduct, loginWithToken, placeOrderViaApi } from './helpers.js'

async function customer(page, request) {
  const user = await apiSignup(request)
  await loginWithToken(page, user.token)
  return user
}

test.describe('Orders: tracking, cancelling, deleting', () => {
  test('a new order is tracked, can be cancelled, and the stock goes back', async ({ page, request }) => {
    const user = await customer(page, request)
    const before = (await getProduct(request, PRODUCTS.shirt.id)).stock
    const order = await placeOrderViaApi(request, user, { productId: PRODUCTS.shirt.id })
    await page.goto(`/orders/${order.id}`)
    await expect(page.locator('.tracker .current')).toContainText('Order placed')
    await expect(page.getByRole('button', { name: 'Delete order' })).toHaveCount(0) // not while it is in progress

    await page.getByRole('button', { name: 'Cancel order' }).click()
    await expect(page.locator('.cancelled')).toHaveText('This order was cancelled.')
    expect((await getOrder(request, user, order.id)).cancelled).toBe(true)
    expect((await getProduct(request, PRODUCTS.shirt.id)).stock).toBe(before) // taken at purchase, returned on cancel
  })

  test('a cancelled order can be deleted from its page', async ({ page, request }) => {
    const user = await customer(page, request)
    const order = await placeOrderViaApi(request, user)
    await page.goto(`/orders/${order.id}`)
    await page.getByRole('button', { name: 'Cancel order' }).click()
    page.once('dialog', (d) => d.accept()) // "Delete this order permanently?"
    await page.getByRole('button', { name: 'Delete order' }).click()
    await expect(page).toHaveURL(/\/orders$/)
    await expect(page.getByRole('heading', { name: 'No orders yet' })).toBeVisible()
    const res = await request.get(`/api/orders/${order.id}`, { headers: user.auth })
    expect(res.status()).toBe(404)
  })

  test('the orders list: only finished orders can be selected, and bulk delete removes them', async ({ page, request }) => {
    const user = await customer(page, request)
    const [a, b, live] = [await placeOrderViaApi(request, user), await placeOrderViaApi(request, user), await placeOrderViaApi(request, user)]
    for (const o of [a, b]) await request.post(`/api/orders/${o.id}/cancel`, { headers: user.auth })

    await page.goto('/orders')
    await expect(page.locator('.order')).toHaveCount(3)
    await expect(page.locator('.order', { hasText: live.id }).getByRole('checkbox')).toHaveCount(0) // in progress: no checkbox
    await expect(page.locator('.order', { hasText: live.id })).toContainText('Order placed')

    await page.getByLabel(/Select all delivered \/ cancelled \(2\)/).check()
    await page.getByRole('button', { name: 'Delete selected (2)' }).click()
    await expect(page.getByText('Delete 2 orders permanently?')).toBeVisible() // a confirmation step
    await page.getByRole('button', { name: 'Yes, delete' }).click()

    await expect(page.locator('.order')).toHaveCount(1)
    await expect(page.locator('.order', { hasText: live.id })).toBeVisible() // the live order is untouched
    const remaining = await (await request.get('/api/orders', { headers: user.auth })).json()
    expect(remaining.map((o) => o.id)).toEqual([live.id])
  })

  test('one customer can never open another customer\'s order', async ({ page, request }) => {
    const owner = await apiSignup(request, 'Owner')
    const order = await placeOrderViaApi(request, owner)
    await customer(page, request) // a different logged-in customer
    await page.goto(`/orders/${order.id}`)
    await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible()
    await expect(page.getByText(order.items[0].title)).toHaveCount(0)
  })
})
