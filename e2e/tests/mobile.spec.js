// Runs in a phone-sized browser (Pixel 7) with touch input; see the "mobile" project in playwright.config.js.
import { expect, test } from '@playwright/test'
import { PAY, PRODUCTS, addToCart, apiSignup, chooseAndReview, getOrder, goToPaymentStep, loginWithToken, mockSpeech, orderIdFromUrl, saveAddress } from './helpers.js'

const noSidewaysScroll = async (page) => {
  const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }))
  expect(scroll, `page is ${scroll}px wide in a ${view}px window`).toBeLessThanOrEqual(view)
}

test.describe('On a phone', () => {
  test('the home page uses the bottom tab bar, and nothing scrolls sideways', async ({ page }) => {
    await page.goto('/')
    const tabs = page.getByRole('navigation', { name: 'Primary' })
    await expect(tabs).toBeVisible()
    for (const name of ['Home', 'Shop', 'Cart', 'Orders', 'Me']) await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible()
    await noSidewaysScroll(page)
  })

  test('products are two to a row; pages fit the screen; filters live in a drawer', async ({ page }) => {
    await page.goto('/products?category=grocery')
    await expect(page.locator('.card').nth(1)).toBeVisible() // wait for the products before measuring them
    const [a, b] = await Promise.all([page.locator('.card').nth(0).boundingBox(), page.locator('.card').nth(1).boundingBox()])
    expect(Math.abs(a.y - b.y)).toBeLessThan(a.height / 2) // same row (cards slide in slightly staggered, so not pixel-identical)
    expect(b.x).toBeGreaterThan(a.x + a.width - 2) // side by side
    await noSidewaysScroll(page)

    await page.getByRole('button', { name: /Filters/ }).click()
    const drawer = page.locator('.listing__filters')
    await expect(drawer).toHaveClass(/is-open/)
    await page.getByLabel('4★ & above').click()
    await page.getByRole('button', { name: /^Show \d+ results/ }).click()
    await expect(drawer).not.toHaveClass(/is-open/)
    await expect(page).toHaveURL(/rating=4/)

    for (const url of [`/products/${PRODUCTS.iphone.id}`, '/cart']) {
      await page.goto(url)
      await noSidewaysScroll(page)
    }
  })

  test('the support chat opens as a sheet that fits the screen, above the tab bar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open support chat' }).click()
    const chat = page.getByRole('dialog', { name: 'Support chat' })
    await expect(chat).toBeVisible()
    const box = await chat.boundingBox()
    const view = page.viewportSize()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    const tabBar = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar.y + 1) // does not cover the tab bar
    await chat.getByLabel('Message').fill('hello')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.locator('.msg--bot').last()).toContainText('help assistant') // "hello" gets the greeting and the menu
    await expect(chat.getByRole('button', { name: 'Talk to a person' })).toBeVisible()
  })

  test('voice search on a phone: the mic is in the search bar and the panel fits the screen', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    const mic = page.getByRole('button', { name: 'Search by voice' })
    await expect(mic).toBeVisible()
    const searchBar = await page.getByRole('search').boundingBox()
    const micBox = await mic.boundingBox()
    expect(micBox.x).toBeGreaterThanOrEqual(searchBar.x) // inside the search bar, not floating off to the side
    expect(micBox.x + micBox.width).toBeLessThanOrEqual(searchBar.x + searchBar.width)

    await mic.click()
    const dialog = page.getByRole('dialog', { name: 'Voice search' })
    await expect(dialog).toContainText('Listening…')
    const card = await dialog.locator('.voice__card').boundingBox()
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(page.viewportSize().width)
    await page.evaluate(() => window.__speech.final('running shoes'))
    await expect(page).toHaveURL(/q=running%20shoes/)
    await noSidewaysScroll(page)
  })

  test('a shopper can buy something start to finish on a phone', async ({ page, request }) => {
    const user = await apiSignup(request)
    await saveAddress(request, user)
    await loginWithToken(page, user.token)
    await addToCart(page, PRODUCTS.shirt.id)
    await goToPaymentStep(page)
    await chooseAndReview(page, PAY.cod)
    await page.getByRole('button', { name: /^Place order/ }).click()
    await expect(page).toHaveURL(/\/orders\/ZS\d{8}$/)
    expect((await getOrder(request, user, orderIdFromUrl(page))).paymentStatus).toBe('cod')
    await noSidewaysScroll(page)
  })
})
