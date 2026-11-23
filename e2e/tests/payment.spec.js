import { expect, test } from '@playwright/test'
import {
  PAY, PRODUCTS, addToCart, apiSignup, chooseAndReview, emailFor, getOrder, getProduct, goToPaymentStep, loginWithToken,
  orderIdFromUrl, rupees, saveAddress,
} from './helpers.js'

// A customer with a saved address and one shirt in the cart, standing on the review step.
async function reviewStep(page, request, method) {
  const user = await apiSignup(request)
  await saveAddress(request, user)
  await loginWithToken(page, user.token)
  await addToCart(page, PRODUCTS.shirt.id)
  await goToPaymentStep(page)
  await chooseAndReview(page, method)
  return user
}
const total = rupees(PRODUCTS.shirt.price)

test.describe('Paying online (mock gateway, test mode)', () => {
  test('card: a declined card can be retried, and the order is paid only after the gateway confirms', async ({ page, request }) => {
    const user = await reviewStep(page, request, PAY.card)
    const stockBefore = (await getProduct(request, PRODUCTS.shirt.id)).stock
    await page.getByRole('button', { name: `Place order & pay ${total}` }).click()

    const dialog = page.getByRole('dialog', { name: 'Secure payment' })
    await expect(dialog).toContainText('TEST MODE')
    await expect(dialog.getByRole('button', { name: `Pay ${total}` })).toBeEnabled() // the payment is ready

    await dialog.getByRole('button', { name: '✗ Declined' }).click() // fills the declining test card
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Your card was declined.')

    await dialog.getByRole('button', { name: '✗ No funds' }).click()
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Insufficient funds.')

    await dialog.getByRole('button', { name: '✓ Success' }).click()
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog).toContainText('Payment successful')

    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    const id = orderIdFromUrl(page)
    await expect(page.locator('.success')).toContainText('Payment received. Your order is confirmed!')

    const order = await getOrder(request, user, id)
    expect(order.paymentStatus).toBe('paid')
    expect(order.paidAt).toBeTruthy() // the shipping clock started when the money arrived
    expect((await getProduct(request, PRODUCTS.shirt.id)).stock).toBe(stockBefore - 1)
    expect((await emailFor(request, id)).html).toContain('Order confirmed') // sent only now, after payment
  })

  test('card: bad card details are rejected without failing the payment', async ({ page, request }) => {
    const user = await reviewStep(page, request, PAY.card)
    await page.getByRole('button', { name: `Place order & pay ${total}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Secure payment' })
    await expect(dialog.getByRole('button', { name: `Pay ${total}` })).toBeEnabled()
    await dialog.getByLabel('Card number').fill('1234')
    await dialog.getByLabel('Expiry').fill('1239')
    await dialog.getByLabel('CVV').fill('123')
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter a valid 16-digit card number.')

    await dialog.getByLabel('Card number').fill('4242424242424242') // fix the number: the SAME payment still works
    await dialog.getByLabel('Expiry').fill('0120') // an expired card
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog.getByRole('alert')).toContainText('unexpired expiry')
    await dialog.getByRole('button', { name: '✓ Success' }).click()
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    expect((await getOrder(request, user, orderIdFromUrl(page))).paymentStatus).toBe('paid')
  })

  test('UPI: a declined payment then a successful one', async ({ page, request }) => {
    const user = await reviewStep(page, request, PAY.upi)
    await page.getByRole('button', { name: `Place order & pay ${total}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Secure payment' })
    await expect(dialog.getByRole('button', { name: `Pay ${total}` })).toBeEnabled()
    await dialog.getByLabel('UPI ID').fill('not-a-upi-id')
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog.getByRole('alert')).toContainText('valid UPI ID')

    await dialog.getByRole('button', { name: '✗ Declined' }).click() // fail@upi
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(dialog.getByRole('alert')).toHaveText('The bank declined this UPI payment.')
    await dialog.getByRole('button', { name: '✓ Success' }).click() // success@upi
    await dialog.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    expect((await getOrder(request, user, orderIdFromUrl(page))).paymentStatus).toBe('paid')
  })

  test('"pay later": the order is held, shown as awaiting payment, and can be paid from the order page', async ({ page, request }) => {
    const user = await reviewStep(page, request, PAY.card)
    const stockBefore = (await getProduct(request, PRODUCTS.shirt.id)).stock
    await page.getByRole('button', { name: `Place order & pay ${total}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Secure payment' })
    await expect(dialog.getByRole('button', { name: `Pay ${total}` })).toBeEnabled()
    await dialog.getByRole('button', { name: /Pay later/ }).click()

    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    const id = orderIdFromUrl(page)
    await expect(page.locator('.pay-banner')).toContainText('Payment pending')
    expect((await getProduct(request, PRODUCTS.shirt.id)).stock).toBe(stockBefore - 1) // stock is held while we wait
    expect((await getOrder(request, user, id)).paymentStatus).toBe('pending')
    expect((await emailFor(request, id)).ok).toBeFalsy() // no confirmation before payment

    await page.goto('/orders')
    await expect(page.locator('.order', { hasText: id })).toContainText('Awaiting payment')

    await page.goto(`/orders/${id}`)
    await page.getByRole('button', { name: `Pay ${total} now` }).click()
    const again = page.getByRole('dialog', { name: 'Secure payment' })
    await expect(again.getByRole('button', { name: `Pay ${total}` })).toBeEnabled()
    await again.getByRole('button', { name: '✓ Success' }).click()
    await again.getByRole('button', { name: `Pay ${total}` }).click()
    await expect(page.locator('.success')).toContainText('Payment received')
    await expect(page.locator('.pay-banner')).toHaveCount(0)
    expect((await getOrder(request, user, id)).paymentStatus).toBe('paid')
    expect((await emailFor(request, id)).html).toContain('Order confirmed')
  })

  test('cancelling an unpaid order releases the stock and voids the payment', async ({ page, request }) => {
    const user = await reviewStep(page, request, PAY.upi)
    const stockBefore = (await getProduct(request, PRODUCTS.shirt.id)).stock
    await page.getByRole('button', { name: `Place order & pay ${total}` }).click()
    await page.getByRole('dialog', { name: 'Secure payment' }).getByRole('button', { name: /Pay later/ }).click()
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    const id = orderIdFromUrl(page)
    await page.getByRole('button', { name: 'Cancel order' }).click()
    await expect(page.locator('.cancelled')).toHaveText('This order was cancelled.')
    const order = await getOrder(request, user, id)
    expect(order).toMatchObject({ cancelled: true, paymentStatus: 'void' })
    expect((await getProduct(request, PRODUCTS.shirt.id)).stock).toBe(stockBefore) // back on the shelf
  })

  test('offers react to the payment method: UPI-only coupons apply on UPI and not on cash on delivery', async ({ page, request }) => {
    const user = await apiSignup(request)
    await saveAddress(request, user)
    await loginWithToken(page, user.token)
    await addToCart(page, PRODUCTS.shirt.id)
    await goToPaymentStep(page)
    await page.getByRole('button', { name: /View all \d+ offers/ }).click() // the panel shows only the best few at first
    const upi5 = page.locator('.offer', { hasText: 'UPI5' })

    await page.getByRole('radio', { name: PAY.cod }).check()
    await expect(upi5).toContainText('Valid only on UPI payments')
    await expect(upi5.getByRole('button', { name: 'Apply' })).toBeDisabled()

    await page.getByRole('radio', { name: PAY.upi }).check()
    await expect(upi5).toContainText('You save ₹145') // 5% of ₹2,899, under the ₹150 cap
    await upi5.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.coupon-applied')).toContainText('UPI5')

    await page.getByRole('radio', { name: PAY.cod }).check() // switching to COD drops the coupon and says why
    await expect(page.locator('.toast', { hasText: 'Coupon UPI5 removed' })).toContainText('UPI')
    await expect(page.locator('.coupon-applied')).toHaveCount(0)
  })
})
