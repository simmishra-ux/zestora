import { expect, test } from '@playwright/test'

test('the shop is up: home page, catalog API and health check', async ({ page, request }) => {
  expect((await request.get('/api/health')).ok()).toBeTruthy()
  const products = await (await request.get('/api/products')).json()
  expect(products.length).toBeGreaterThan(150) // the seeded photo catalog

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Shop what')
  await expect(page.locator('.deals .card').first()).toBeVisible() // product cards (with photos) have loaded from the API
})
