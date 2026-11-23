import { expect, test } from '@playwright/test'
import { PASSWORD, adminSession, apiSignup, loginWithToken, uniqueEmail } from './helpers.js'

test.describe('Accounts and access control', () => {
  test('sign up, log out, then log back in', async ({ page }) => {
    const email = uniqueEmail('signup')
    await page.goto('/signup')
    await page.getByLabel('Full name').fill('Riya Menon')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'R', exact: true })).toBeVisible() // avatar with the first letter

    await page.getByRole('button', { name: 'R', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible()

    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'R', exact: true })).toBeVisible()
  })

  test('the session survives a page refresh', async ({ page, request }) => {
    const user = await apiSignup(request, 'Kabir Shah')
    await loginWithToken(page, user.token)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Kabir Shah' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Kabir Shah' })).toBeVisible()
  })

  test('wrong password shows one safe message; bad input is caught before sending', async ({ page, request }) => {
    const user = await apiSignup(request)
    await page.goto('/login')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill('not-the-password-1')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.') // same text whether the email exists or not
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/signup')
    await page.getByLabel('Full name').fill('A')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByLabel('Confirm password').fill('different')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Please enter your name.')).toBeVisible()
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(page.getByText(/Password needs at least 8 characters/)).toBeVisible()
    await expect(page.getByText('Passwords do not match.')).toBeVisible()
  })

  test('an email can only be registered once', async ({ page, request }) => {
    const user = await apiSignup(request)
    await page.goto('/signup')
    await page.getByLabel('Full name').fill('Someone Else')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('alert')).toContainText('already exists')
  })

  test('private pages send you to log in, then bring you back', async ({ page, request }) => {
    const user = await apiSignup(request)
    await page.goto('/orders')
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/orders$/)
    await expect(page.getByRole('heading', { name: 'No orders yet' })).toBeVisible()
  })

  test('the admin area is closed to visitors and to ordinary customers', async ({ page, request }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/)

    const user = await apiSignup(request)
    await loginWithToken(page, user.token)
    await page.goto('/admin')
    await expect(page).toHaveURL('/') // a customer is sent home
    await page.getByRole('button', { name: /^[A-Z]$/ }).click()
    await expect(page.getByRole('menuitem', { name: /Admin dashboard/ })).toHaveCount(0)
  })

  test('the admin sees the dashboard link and the dashboard', async ({ page, request }) => {
    const admin = await adminSession(request)
    await loginWithToken(page, admin.token)
    await page.goto('/')
    await page.getByRole('button', { name: 'S', exact: true }).click()
    await page.getByRole('menuitem', { name: /Admin dashboard/ }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Store dashboard' })).toBeVisible()
  })

  test('profile: edit details and manage the address book (add, default, delete)', async ({ page, request }) => {
    const user = await apiSignup(request)
    await loginWithToken(page, user.token)
    await page.goto('/profile')

    await page.getByLabel('Full name').first().fill('Asha V. Verma')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Profile updated')).toBeVisible()

    const addAddress = async (label, line1) => {
      await page.getByRole('button', { name: '+ Add new address' }).click()
      const dialog = page.getByRole('dialog', { name: 'Address form' })
      await dialog.getByRole('radio', { name: label }).click()
      await dialog.getByLabel('Full name').fill('Asha Verma')
      await dialog.getByLabel('Mobile number').fill('9876543210')
      await dialog.getByLabel('Address', { exact: true }).fill(line1)
      await dialog.getByLabel('City', { exact: true }).fill('Pune')
      await dialog.getByLabel('State', { exact: true }).fill('Maharashtra')
      await dialog.getByLabel('Pincode').fill('411001')
      await dialog.getByRole('button', { name: 'Save address' }).click()
      await expect(dialog).toBeHidden()
    }
    await addAddress('Home', '12 MG Road, Camp')
    await addAddress('Work', 'Tech Park, Hinjewadi')
    const cards = page.locator('.addr-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toContainText('Home') // the first address is the default automatically
    await expect(cards.first()).toContainText('Default')

    await page.locator('.addr-card', { hasText: 'Work' }).getByRole('button', { name: 'Set as default' }).click()
    await expect(cards.first()).toContainText('Work') // the default is listed first
    page.once('dialog', (d) => d.accept())
    await page.locator('.addr-card', { hasText: 'Home' }).getByRole('button', { name: 'Delete' }).click()
    await expect(cards).toHaveCount(1)
  })
})
