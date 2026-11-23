import { expect, test } from '@playwright/test'
import { PRODUCTS } from './helpers.js'

test.describe('Browsing the shop', () => {
  test('home page leads into a category, then a sub-category', async ({ page, request }) => {
    // Expected counts come from the API, not constants: other tests (e.g. the admin one) add and hide products.
    const count = async (query) => (await (await request.get(`/api/products?${query}`)).json()).length
    const inCategory = await count('category=electronics')
    const phones = await count('category=electronics&sub=smartphones')

    await page.goto('/')
    await page.locator('.cats').getByRole('link', { name: 'Electronics' }).click()
    await expect(page).toHaveURL(/category=electronics/)
    await expect(page.getByRole('heading', { level: 1, name: 'Electronics' })).toBeVisible()
    await expect(page.getByText(`${inCategory} products`)).toBeVisible()

    await page.locator('.cat-scroll--sub').getByRole('button', { name: 'Smartphones' }).click()
    await expect(page).toHaveURL(/sub=smartphones/)
    await expect(page.getByRole('heading', { level: 1, name: 'Smartphones' })).toBeVisible()
    await expect(page.getByText(`${phones} products`)).toBeVisible()
    await expect(page.locator('.card', { hasText: PRODUCTS.iphone.title })).toBeVisible()
  })

  test('sorting by price puts the cheapest first, and filters show up as removable chips', async ({ page }) => {
    await page.goto('/products?category=grocery')
    await page.getByLabel('Sort by').selectOption('price-asc')
    await expect(page).toHaveURL(/sort=price-asc/)
    const prices = await page.locator('.card .price strong').allTextContents()
    const numbers = prices.map((p) => Number(p.replace(/[^\d]/g, '')))
    expect(numbers.length).toBeGreaterThan(10)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))

    await page.getByLabel('4★ & above').click()
    await expect(page.getByLabel('4★ & above')).toBeChecked()
    const chip = page.locator('.chips').getByRole('button', { name: /4★\+/ })
    await expect(chip).toBeVisible()
    await chip.click() // removing the chip removes the filter
    await expect(page).not.toHaveURL(/rating=4/)
  })

  test('the "in stock only" filter hides sold-out products', async ({ page, request }) => {
    const all = await (await request.get('/api/products?category=grocery')).json()
    const inStock = await (await request.get('/api/products?category=grocery&inStock=true')).json()
    await page.goto('/products?category=grocery')
    await expect(page.getByText(`${all.length} products`)).toBeVisible()
    await page.getByLabel('In stock only').click() // click + assert: the URL updates a moment after the click
    await expect(page.getByLabel('In stock only')).toBeChecked()
    await expect(page.getByText(`${inStock.length} products`)).toBeVisible()
    expect(inStock.length).toBeLessThanOrEqual(all.length)
  })

  test('the URL is the source of truth: a shared link restores the same filters', async ({ page }) => {
    await page.goto('/products?category=fashion&sub=womens-bags&sort=price-desc')
    await expect(page.getByRole('heading', { level: 1, name: 'Bags' })).toBeVisible()
    await expect(page.getByLabel('Sort by')).toHaveValue('price-desc')
    const prices = (await page.locator('.card .price strong').allTextContents()).map((p) => Number(p.replace(/[^\d]/g, '')))
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Bags' })).toBeVisible()
  })

  test('search suggests products as you type and opens the one you pick', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Search products').fill('iphone')
    const suggestion = page.getByRole('option', { name: /iPhone 13 Pro/ })
    await expect(suggestion).toBeVisible()
    await suggestion.click()
    await expect(page).toHaveURL(new RegExp(`/products/${PRODUCTS.iphone.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: PRODUCTS.iphone.title })).toBeVisible()
  })

  test('searching for something that does not exist shows a friendly empty state', async ({ page }) => {
    await page.goto('/products?q=unicornsaddle')
    await expect(page.getByRole('heading', { name: 'No products match' })).toBeVisible()
  })

  test('a product page shows photos, price, specifications and a delivery check', async ({ page }) => {
    await page.goto(`/products/${PRODUCTS.iphone.id}`)
    await expect(page.getByRole('heading', { level: 1, name: PRODUCTS.iphone.title })).toBeVisible()
    await expect(page.locator('.price--lg')).toContainText('₹91,299')
    await expect(page.locator('.gallery__thumbs button')).toHaveCount(3)
    await page.getByRole('button', { name: 'View 2' }).click()
    await expect(page.getByRole('button', { name: 'View 2' })).toHaveClass(/on/)
    await expect(page.getByRole('heading', { name: 'Specifications' })).toBeVisible()
    await expect(page.locator('.specs')).toContainText('Warranty')

    await page.getByLabel('Pincode').fill('560038')
    await page.getByRole('button', { name: 'Check' }).click()
    await expect(page.getByText(/Delivery by/)).toBeVisible()
  })

  test('an unknown product shows "not found" instead of crashing', async ({ page }) => {
    await page.goto('/products/p999')
    await expect(page.getByRole('heading', { name: 'Product not found' })).toBeVisible()
    await page.goto('/this/page/does/not/exist')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })
})
