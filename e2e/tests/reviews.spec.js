import { expect, test } from '@playwright/test'
import { apiSignup, getProduct, loginWithToken, placeOrderViaApi } from './helpers.js'

const CASE = { id: 'p134', title: 'iPhone 12 Silicone Case' } // a product only this spec reviews

test.describe('Reviews and ratings', () => {
  test('only buyers can review; reviews update the average; buyers can edit and delete theirs', async ({ page, request }) => {
    const before = await getProduct(request, CASE.id)
    const buyer = await apiSignup(request, 'Asha Verma')
    await placeOrderViaApi(request, buyer, { productId: CASE.id })
    await loginWithToken(page, buyer.token)
    await page.goto(`/products/${CASE.id}`)

    // a missing star rating is caught
    await page.getByRole('button', { name: 'Submit review' }).click()
    await expect(page.getByText('Please choose a star rating.')).toBeVisible()

    await page.getByRole('radio', { name: '5 stars' }).click()
    await page.getByLabel('Review headline').fill('Fits perfectly')
    await page.getByLabel('Review text').fill('Snug fit and the buttons still click well.')
    await page.getByRole('button', { name: 'Submit review' }).click()
    await expect(page.locator('.toast', { hasText: 'Thanks for your review!' })).toBeVisible()

    const review = page.locator('blockquote.review', { hasText: 'Fits perfectly' })
    await expect(review).toContainText('Verified buyer')
    await expect(review).toContainText('Asha V.') // never the full name or email
    await expect(page.getByRole('heading', { name: 'Your review' })).toBeVisible()
    let now = await getProduct(request, CASE.id)
    expect(now.reviews).toBe(before.reviews + 1)
    expect(now.rating).toBeCloseTo((before.rating * before.reviews + 5) / (before.reviews + 1), 6)

    await page.getByRole('radio', { name: '3 stars' }).click() // edit: 5 -> 3
    await page.getByRole('button', { name: 'Update review' }).click()
    await expect(page.locator('blockquote.review', { hasText: 'Fits perfectly' }).locator('.stars')).toHaveAttribute('aria-label', '3 out of 5')
    now = await getProduct(request, CASE.id)
    expect(now.reviews).toBe(before.reviews + 1) // edited, not added again
    expect(now.rating).toBeCloseTo((before.rating * before.reviews + 3) / (before.reviews + 1), 6)

    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Delete my review' }).click()
    await expect(page.getByText('No written reviews yet.')).toBeVisible()
    now = await getProduct(request, CASE.id)
    expect(now.reviews).toBe(before.reviews) // everything is back to how it was
    expect(now.rating).toBeCloseTo(before.rating, 6)
  })

  test('customers who have not bought the product, and visitors, are told why they cannot review', async ({ page, request }) => {
    await page.goto(`/products/${CASE.id}`)
    await expect(page.locator('.review-note')).toContainText('to review products')
    await expect(page.getByRole('button', { name: 'Submit review' })).toHaveCount(0)

    const stranger = await apiSignup(request)
    await loginWithToken(page, stranger.token)
    await page.reload()
    await expect(page.locator('.review-note')).toHaveText('Only customers who bought this product can review it.')
    const res = await request.put(`/api/products/${CASE.id}/reviews/me`, { headers: stranger.auth, data: { rating: 5 } })
    expect(res.status()).toBe(403) // and the server enforces it even if someone skips the page
  })
})
