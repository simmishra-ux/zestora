import { expect, test } from '@playwright/test'
import {
  ADDRESS, PAY, PRODUCTS, addToCart, apiSignup, chooseAndReview, emailFor, fillAddress, getOrder, getProduct,
  goToPaymentStep, loginWithToken, orderIdFromUrl, placeOrderViaApi, rupees, saveAddress, PASSWORD,
} from './helpers.js'

test.describe('Checkout with cash on delivery', () => {
  test('a new customer buys a product, from the shelf to the confirmation email', async ({ page, request }) => {
    const user = await apiSignup(request)
    await loginWithToken(page, user.token)
    const before = await getProduct(request, PRODUCTS.shirt.id)

    await addToCart(page, PRODUCTS.shirt.id)
    await page.goto('/cart')
    await page.getByRole('button', { name: 'Proceed to checkout' }).click()

    // step 1: a new address (this customer has none yet) and where to send the confirmation
    await expect(page.getByRole('heading', { name: 'Delivery address' })).toBeVisible()
    await fillAddress(page)
    await expect(page.getByLabel('Email for order confirmation')).toHaveValue(user.email) // prefilled from the account
    await page.getByRole('button', { name: 'Deliver here' }).click()

    // step 2: payment method and a coupon
    await expect(page.getByRole('heading', { name: 'Payment method' })).toBeVisible()
    await page.getByLabel('Coupon code').fill('ZEST10')
    await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
    await expect(page.locator('.coupon-applied')).toContainText('ZEST10 applied')
    await chooseAndReview(page, PAY.cod)

    // step 3: review and place
    const discount = Math.round(PRODUCTS.shirt.price * 0.1)
    const total = PRODUCTS.shirt.price - discount // above ₹499, so delivery is free
    await expect(page.locator('.review-box')).toContainText(ADDRESS.line1)
    await expect(page.locator('.review-box')).toContainText('Coupon ZEST10 applied')
    await page.getByRole('button', { name: `Place order · ${rupees(total)}` }).click()

    // the confirmation page
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    const id = orderIdFromUrl(page)
    await expect(page.getByRole('heading', { level: 1, name: `Order #${id}` })).toBeVisible()
    await expect(page.locator('.success')).toContainText('Thank you! Your order is confirmed.')
    await expect(page.locator('.success')).toContainText('Learning mode') // no real mail server in tests: the email is in the dev inbox
    await expect(page.locator('.tracker .current')).toContainText('Order placed')
    await expect(page.locator('.summary .total')).toContainText(rupees(total))

    // what the SERVER recorded (not just what the page shows)
    const order = await getOrder(request, user, id)
    expect(order).toMatchObject({ paymentMethod: 'cod', paymentStatus: 'cod', couponCode: 'ZEST10', cancelled: false })
    expect(order.totals).toMatchObject({ subtotal: PRODUCTS.shirt.price, couponDiscount: discount, delivery: 0, total })
    expect(order.address).toMatchObject({ city: ADDRESS.city, pincode: ADDRESS.pincode })
    expect(order.contactEmail).toBe(user.email)
    expect((await getProduct(request, PRODUCTS.shirt.id)).stock).toBe(before.stock - 1) // stock was taken

    // the confirmation email exists and contains the order
    const mail = await emailFor(request, id)
    expect(mail.ok).toBeTruthy()
    expect(mail.html).toContain('Order confirmed')
    expect(mail.html).toContain(id)
    expect(mail.html).toContain(PRODUCTS.shirt.title)

    // the cart is empty, the order is listed, and the new address was saved to the address book
    await expect(page.locator('header').getByRole('link', { name: 'Cart' }).locator('.badge')).toHaveCount(0)
    await page.goto('/orders')
    await expect(page.locator('.order', { hasText: id })).toBeVisible()
    await page.goto('/profile')
    await expect(page.locator('.addr-card')).toContainText(ADDRESS.city)
  })

  test('the delivery fee is charged on a small order and shown at every step', async ({ page, request }) => {
    const user = await apiSignup(request)
    await saveAddress(request, user)
    await loginWithToken(page, user.token)
    await addToCart(page, PRODUCTS.cheap.id)
    await goToPaymentStep(page)
    await expect(page.locator('.summary .row', { hasText: 'Delivery' })).toContainText('₹49')
    await chooseAndReview(page, PAY.cod)
    await page.getByRole('button', { name: `Place order · ${rupees(PRODUCTS.cheap.price + 49)}` }).click()
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    const order = await getOrder(request, user, orderIdFromUrl(page))
    expect(order.totals).toMatchObject({ delivery: 49, total: PRODUCTS.cheap.price + 49 })
  })

  test('a saved default address is preselected and used', async ({ page, request }) => {
    const user = await apiSignup(request)
    await saveAddress(request, user, { label: 'Work', line1: '5 Tech Park, Whitefield' })
    await loginWithToken(page, user.token)
    await addToCart(page, PRODUCTS.shirt.id)
    await page.goto('/checkout')
    const saved = page.getByRole('radio', { name: /Work/ })
    await expect(saved).toBeChecked()
    await expect(page.getByLabel('Full name')).toHaveCount(0) // no form: a saved address is selected
    await page.getByRole('button', { name: 'Deliver here' }).click()
    await chooseAndReview(page, PAY.cod)
    await page.getByRole('button', { name: /^Place order/ }).click()
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    expect((await getOrder(request, user, orderIdFromUrl(page))).address.line1).toBe('5 Tech Park, Whitefield')
  })

  test('mistakes in the address and email are explained before anything is sent', async ({ page, request }) => {
    const user = await apiSignup(request)
    await loginWithToken(page, user.token)
    await addToCart(page, PRODUCTS.shirt.id)
    await page.goto('/checkout')
    await page.getByLabel('Email for order confirmation').fill('not-an-email')
    await page.getByRole('button', { name: 'Deliver here' }).click()
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(page.getByText('Enter a valid 10-digit mobile number.')).toBeVisible()
    await expect(page.getByText('Enter your full address.')).toBeVisible()
    await expect(page.getByText('6-digit pincode.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Delivery address' })).toBeVisible() // still on step 1

    await page.getByRole('button', { name: 'Back to cart' }).click()
    await expect(page).toHaveURL(/\/cart$/)
    await expect(page.locator('.line')).toHaveCount(1) // nothing was lost
  })

  test('checking out while logged out sends you to log in, then straight back to checkout', async ({ page, request }) => {
    const user = await apiSignup(request)
    await addToCart(page, PRODUCTS.shirt.id) // as a visitor
    await page.goto('/cart')
    await page.getByRole('button', { name: 'Login to checkout' }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/checkout$/)
    await expect(page.getByRole('heading', { name: 'Delivery address' })).toBeVisible()
    await expect(page.locator('.line, .summary').first()).toBeVisible() // the cart survived logging in
  })

  test('when someone else buys the last unit first, the order is refused and nothing is charged', async ({ page, request }) => {
    const buyerA = await apiSignup(request, 'Slow Shopper')
    const buyerB = await apiSignup(request, 'Fast Shopper')
    await saveAddress(request, buyerA)
    await loginWithToken(page, buyerA.token)
    expect((await getProduct(request, PRODUCTS.lastUnit.id)).stock).toBe(1)
    await addToCart(page, PRODUCTS.lastUnit.id) // A has it in the cart...

    await placeOrderViaApi(request, buyerB, { productId: PRODUCTS.lastUnit.id }) // ...B buys the last one

    await goToPaymentStep(page)
    await chooseAndReview(page, PAY.cod)
    await page.getByRole('button', { name: /^Place order/ }).click()
    await expect(page.locator('.toast--error')).toContainText(/Only 0 left|just sold out/)
    await expect(page.getByRole('heading', { name: 'Review your order' })).toBeVisible() // still here, not on an order page
    const orders = await (await request.get('/api/orders', { headers: buyerA.auth })).json()
    expect(orders).toHaveLength(0) // A has no order
    expect((await getProduct(request, PRODUCTS.lastUnit.id)).stock).toBe(0) // and stock never went negative
  })
})
