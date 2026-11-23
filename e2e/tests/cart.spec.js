import { expect, test } from '@playwright/test'
import { PRODUCTS, addToCart, apiSignup, loginWithToken, rupees } from './helpers.js'

test.describe('Cart and coupons', () => {
  test('add to cart, change the quantity, reload, remove', async ({ page }) => {
    await addToCart(page, PRODUCTS.shirt.id)
    await expect(page.locator('header').getByRole('link', { name: 'Cart' }).locator('.badge')).toHaveText('1')

    await page.goto('/cart')
    await expect(page.getByRole('heading', { level: 1, name: /Shopping cart/ })).toContainText('1 items')
    await page.getByRole('button', { name: 'Increase quantity' }).click()
    await expect(page.locator('.line output')).toHaveText('2')
    await expect(page.locator('.summary .total')).toContainText(rupees(PRODUCTS.shirt.price * 2)) // free delivery above ₹499

    await page.reload() // the cart is saved in the browser
    await expect(page.locator('.line output')).toHaveText('2')

    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible()
  })

  test('delivery fee below ₹499, free delivery above it, with a progress hint', async ({ page }) => {
    await addToCart(page, PRODUCTS.cheap.id)
    await page.goto('/cart')
    await expect(page.locator('.freebar')).toContainText('more for free delivery')
    await expect(page.locator('.summary .row', { hasText: 'Delivery' })).toContainText('₹49')
    await expect(page.locator('.summary .total')).toContainText(rupees(PRODUCTS.cheap.price + 49))

    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Increase quantity' }).click() // 5 x ₹119 = ₹595
    await expect(page.locator('.freebar')).toContainText('unlocked free delivery')
    await expect(page.locator('.summary .row', { hasText: 'Delivery' })).toContainText('FREE')
  })

  test('offers show what you would save, or why they do not apply yet', async ({ page, request }) => {
    const user = await apiSignup(request)
    await loginWithToken(page, user.token) // a brand-new customer: eligible for the first-order offer
    await addToCart(page, PRODUCTS.cheap.id)
    await page.goto('/cart')
    const offers = page.locator('.offers')
    await expect(offers.locator('.offer', { hasText: 'FLAT200' })).toContainText('Add ₹1,880 more to use this offer')
    await expect(offers.locator('.offer', { hasText: 'FLAT200' }).getByRole('button', { name: 'Apply' })).toBeDisabled()
    await expect(offers.locator('.offer', { hasText: 'ZEST10' })).toContainText('You save ₹12') // 10% of ₹119, rounded
    await expect(offers.locator('.offer', { hasText: 'WELCOME15' })).toContainText('You save') // first order
  })

  test('apply a coupon, see the totals change, remove it again', async ({ page }) => {
    await addToCart(page, PRODUCTS.iphone.id)
    await page.goto('/cart')
    const saving = Math.round(PRODUCTS.iphone.price * 0.1) // ZEST10 = 10%, no cap
    const best = page.locator('.offer', { hasText: 'ZEST10' })
    await expect(best).toContainText('Best offer')
    await expect(best).toContainText(`You save ${rupees(saving)}`)

    await best.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.coupon-applied')).toContainText('ZEST10 applied')
    await expect(page.locator('.summary .row', { hasText: 'Coupon' })).toContainText(`− ${rupees(saving)}`)
    await expect(page.locator('.summary .total')).toContainText(rupees(PRODUCTS.iphone.price - saving))

    await page.locator('.coupon-applied').getByRole('button', { name: 'Remove' }).click()
    await expect(page.locator('.summary .total')).toContainText(rupees(PRODUCTS.iphone.price))
  })

  test('typing a code works in any case; a wrong code is refused with a message', async ({ page }) => {
    await addToCart(page, PRODUCTS.iphone.id)
    await page.goto('/cart')
    await page.getByLabel('Coupon code').fill('nope123')
    await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
    await expect(page.getByText(/isn.t valid/)).toBeVisible()

    await page.getByLabel('Coupon code').fill('zest10')
    await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
    await expect(page.locator('.coupon-applied')).toContainText('ZEST10 applied')
  })

  test('a coupon is dropped, with a reason, when the cart no longer qualifies', async ({ page }) => {
    await addToCart(page, PRODUCTS.iphone.id)
    await page.goto('/cart')
    await page.getByLabel('Coupon code').fill('FLAT200') // needs a ₹1,999 cart
    await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
    await expect(page.locator('.coupon-applied')).toContainText('FLAT200')
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click() // empty the cart
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible()
    await addToCart(page, PRODUCTS.cheap.id) // ₹119: below the minimum
    await expect(page.locator('.toast', { hasText: 'Coupon FLAT200 removed' })).toContainText('Add ₹1,880 more') // and we are told why
    await page.goto('/cart')
    await expect(page.locator('.coupon-applied')).toHaveCount(0)
  })

  test('sold-out products cannot be bought', async ({ page }) => {
    await page.goto(`/products/${PRODUCTS.soldOut.id}`)
    await expect(page.locator('.info').getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    await expect(page.locator('.info').getByRole('button', { name: 'Out of stock' })).toBeDisabled()
    await page.goto('/products?category=electronics&sub=smartphones')
    await expect(page.locator('.card', { hasText: PRODUCTS.soldOut.title }).locator('.tag--out')).toHaveText('Sold out')
  })

  test('wishlist: save, see it everywhere, remove', async ({ page }) => {
    await page.goto('/products?category=grocery')
    const card = page.locator('.card').first()
    const title = (await card.locator('.card__title').textContent()).trim()
    await card.getByRole('button', { name: 'Add to wishlist' }).click()
    await expect(page.locator('header').getByRole('link', { name: 'Wishlist' }).locator('.badge')).toHaveText('1')

    await page.goto('/wishlist')
    await expect(page.getByRole('heading', { level: 1, name: /My wishlist/ })).toContainText('(1)')
    await expect(page.locator('.card', { hasText: title })).toBeVisible()
    await page.reload() // saved in the browser
    await expect(page.locator('.card', { hasText: title })).toBeVisible()

    await page.locator('.card', { hasText: title }).getByRole('button', { name: 'Remove from wishlist' }).click()
    await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible()
  })
})
