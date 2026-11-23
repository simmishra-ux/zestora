import { expect, test } from '@playwright/test'
import { PRODUCTS, mockSpeech } from './helpers.js'

const speech = (page, fn, arg) => page.evaluate(([name, a]) => window.__speech[name](a), [fn, arg])
const openVoice = async (page) => {
  await page.getByRole('button', { name: 'Search by voice' }).click()
  const dialog = page.getByRole('dialog', { name: 'Voice search' })
  await expect(dialog).toContainText('Listening…') // the microphone is open
  return dialog
}

test.describe('Voice search', () => {
  test('speak a product name: words appear as you talk, then it searches by itself', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    const dialog = await openVoice(page)
    await expect(dialog).toContainText('Try saying') // a hint before anything is heard

    await speech(page, 'interim', 'iphone')
    await expect(dialog.locator('.voice__heard')).toHaveText('iphone') // live transcript while still speaking
    await speech(page, 'interim', 'iphone 13')
    await expect(dialog.locator('.voice__heard')).toHaveText('iphone 13')
    await speech(page, 'final', 'iPhone 13 Pro.') // the engine adds a full stop

    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/products\?q=iPhone%2013%20Pro$/) // punctuation removed
    await expect(page.getByLabel('Search products')).toHaveValue('iPhone 13 Pro') // also shown in the search box
    await expect(page.locator('.card', { hasText: PRODUCTS.iphone.title })).toBeVisible()
  })

  test('the microphone is switched off after a result (nothing keeps listening)', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    await openVoice(page)
    await speech(page, 'final', 'coffee')
    await expect(page).toHaveURL(/q=coffee/)
    expect(await page.evaluate(() => window.__speech.control.instance.aborted)).toBe(true)
  })

  test('cancel with the button or with Escape: no search happens and the microphone stops', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    let dialog = await openVoice(page)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => window.__speech.control.instance.aborted)).toBe(true)
    await expect(page).toHaveURL('/')

    dialog = await openVoice(page) // and again, closed with the keyboard
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => window.__speech.control.starts)).toBe(2)
    await expect(page).toHaveURL('/')
  })

  test('nothing heard: a friendly message and "Try again" works', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    const dialog = await openVoice(page)
    await speech(page, 'silence') // the engine ends without hearing anything
    await expect(dialog.getByRole('heading', { name: "Didn't catch that" })).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('try again')

    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(dialog).toContainText('Listening…')
    await speech(page, 'final', 'laptop')
    await expect(page).toHaveURL(/q=laptop/)
  })

  test('a blocked microphone is explained, and works once access is allowed', async ({ page }) => {
    await mockSpeech(page)
    await page.addInitScript(() => { window.__speech.control.denied = true })
    await page.goto('/')
    await page.getByRole('button', { name: 'Search by voice' }).click()
    const dialog = page.getByRole('dialog', { name: 'Voice search' })
    await expect(dialog.getByRole('heading', { name: 'Microphone is blocked' })).toBeVisible()
    await expect(dialog).toContainText('Allow microphone access')

    await page.evaluate(() => { window.__speech.control.denied = false }) // the person allows the microphone
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(dialog).toContainText('Listening…')
    await speech(page, 'final', 'shoes')
    await expect(page).toHaveURL(/q=shoes/)
  })

  test('other failures get their own clear message, never a blank or stuck panel', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    const cases = [
      ['network', 'Voice search is unavailable', 'type your search'],
      ['audio-capture', 'No microphone found', 'Connect a microphone'],
      ['something-unexpected', 'Something went wrong', 'try again'],
    ]
    for (const [code, title, text] of cases) {
      const dialog = await openVoice(page)
      await speech(page, 'fail', code)
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
      await expect(dialog).toContainText(text)
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    }
  })

  test('an empty recording (only punctuation) is treated as "nothing heard", not searched', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    const dialog = await openVoice(page)
    await speech(page, 'final', '...')
    await expect(dialog.getByRole('heading', { name: "Didn't catch that" })).toBeVisible()
    await expect(page).toHaveURL('/')
  })

  test('the panel is accessible: a labelled dialog, a live transcript, and focus moves into it', async ({ page }) => {
    await mockSpeech(page)
    await page.goto('/')
    const dialog = await openVoice(page)
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.locator('.voice__heard')).toHaveAttribute('aria-live', 'polite')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused() // keyboard users land inside the panel
    await expect(dialog.locator('.voice__note')).toContainText('speech service') // we say where the audio may go
  })

  test('voice search works from any page, e.g. a product page', async ({ page }) => {
    await mockSpeech(page)
    await page.goto(`/products/${PRODUCTS.shirt.id}`)
    await openVoice(page)
    await speech(page, 'final', 'iphone')
    await expect(page).toHaveURL(/\/products\?q=iphone/)
    await expect(page.locator('.card', { hasText: 'iPhone' }).first()).toBeVisible()
  })

  test('browsers without speech recognition simply have no mic button, and typing still works', async ({ page }) => {
    await mockSpeech(page, { supported: false })
    await page.goto('/')
    await expect(page.getByLabel('Search products')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search by voice' })).toHaveCount(0)

    await page.getByLabel('Search products').fill('coffee')
    await page.getByLabel('Search products').press('Enter')
    await expect(page).toHaveURL(/q=coffee/)
  })
})
