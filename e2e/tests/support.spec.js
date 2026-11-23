import { expect, test } from '@playwright/test'
import { PRODUCTS, adminSession, apiSignup, loginWithToken, placeOrderViaApi } from './helpers.js'

const openChat = async (page) => {
  await page.getByRole('button', { name: 'Open support chat' }).click()
  const chat = page.getByRole('dialog', { name: 'Support chat' })
  await expect(chat).toBeVisible()
  return chat
}
const say = async (chat, text) => {
  await chat.getByLabel('Message').fill(text)
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
}
const lastBot = (chat) => chat.locator('.msg--bot:not(.msg--typing)').last()

test.describe('Support chat: the help assistant', () => {
  test('visitors get general answers, and are asked to log in for anything personal', async ({ page }) => {
    await page.goto('/')
    const chat = await openChat(page)
    await expect(chat).toContainText("I'm Zestora's help assistant")
    await expect(chat.locator('.chat__head')).toContainText('Log in to talk to our team')

    await say(chat, 'What are the delivery charges?')
    await expect(lastBot(chat)).toContainText('₹499') // the real free-delivery threshold from the shop's code
    await chat.getByRole('button', { name: 'Where is my order?' }).click()
    await expect(lastBot(chat)).toContainText('log in')
    await expect(chat.getByRole('link', { name: 'Log in' }).first()).toBeVisible()

    await say(chat, 'I want to talk to a person')
    await expect(lastBot(chat)).toContainText('log in') // a visitor cannot open a ticket
  })

  test('a customer asks where an order is and gets its real status, with a link to it', async ({ page, request }) => {
    const user = await apiSignup(request)
    const order = await placeOrderViaApi(request, user, { productId: PRODUCTS.shirt.id })
    await loginWithToken(page, user.token)
    await page.goto('/')
    const chat = await openChat(page)

    await chat.getByRole('button', { name: 'Where is my order?' }).click()
    await expect(lastBot(chat)).toContainText('Which order would you like me to check?')
    await chat.getByRole('button', { name: order.id }).click() // one tap, like a real conversation
    await expect(lastBot(chat)).toContainText(`Order ${order.id}`)
    await expect(lastBot(chat)).toContainText('currently: Order placed')
    await expect(lastBot(chat)).toContainText('cash on delivery')

    await chat.getByRole('link', { name: `Open order ${order.id}` }).click()
    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`))
    await expect(chat).toBeHidden() // the chat steps aside after following a link
  })

  test('the bot answers about products and coupons from live data', async ({ page, request }) => {
    const user = await apiSignup(request)
    await loginWithToken(page, user.token)
    await page.goto('/')
    const chat = await openChat(page)
    await say(chat, 'is the iPhone 13 Pro available?')
    await expect(lastBot(chat)).toContainText('iPhone 13 Pro')
    await expect(lastBot(chat)).toContainText('₹91,299')
    await expect(lastBot(chat)).toContainText('in stock')

    await say(chat, 'tell me about the UPI5 coupon')
    await expect(lastBot(chat)).toContainText('UPI only')
    await say(chat, 'asdf qwer zxcv')
    await expect(lastBot(chat)).toContainText('not sure I understood')
  })

  test('a quality complaint opens a ticket for the right order, and the customer can add details', async ({ page, request }) => {
    const user = await apiSignup(request)
    const order = await placeOrderViaApi(request, user, { productId: PRODUCTS.shirt.id })
    await loginWithToken(page, user.token)
    await page.goto('/')
    const chat = await openChat(page)

    await chat.getByRole('button', { name: 'Quality issue' }).click()
    await expect(lastBot(chat)).toContainText('Which order is it about?')
    await chat.getByRole('button', { name: order.id }).click()
    await expect(chat.locator('.msg--bot', { hasText: /Ticket ZT\d{6}/ })).toBeVisible()
    await expect(chat.locator('.chat__head')).toContainText('Waiting for our team')

    const botMessages = await chat.locator('.msg--bot').count()
    await say(chat, 'The sleeve is torn and a button is missing.')
    await expect(chat.locator('.msg--user', { hasText: 'sleeve is torn' })).toBeVisible()
    await expect(chat.locator('.msg--bot')).toHaveCount(botMessages) // a person is handling it now: the bot stays quiet

    const thread = await (await request.get('/api/support/thread', { headers: user.auth })).json()
    expect(thread).toMatchObject({ status: 'waiting_agent', category: 'quality', orderId: order.id })
  })

  test('a payment problem is explained, and "money was deducted" becomes a payment ticket', async ({ page, request }) => {
    const user = await apiSignup(request)
    const order = await placeOrderViaApi(request, user, { productId: PRODUCTS.shirt.id, method: 'upi' }) // never paid
    await loginWithToken(page, user.token)
    await page.goto('/')
    const chat = await openChat(page)

    await chat.getByRole('button', { name: 'Payment problem' }).click()
    await expect(lastBot(chat)).toContainText('Which order is the payment for?')
    await chat.getByRole('button', { name: order.id }).click()
    await expect(lastBot(chat)).toContainText("hasn't been completed")
    await expect(lastBot(chat)).toContainText('Pay now')

    await chat.getByRole('button', { name: 'Money was deducted' }).click()
    await expect(chat.locator('.msg--bot', { hasText: /Ticket ZT\d{6}/ })).toBeVisible()
    const thread = await (await request.get('/api/support/thread', { headers: user.auth })).json()
    expect(thread).toMatchObject({ status: 'waiting_agent', category: 'payment', orderId: order.id })
  })

  test('typing is rendered as plain text (no HTML or script runs), and messages are private to each customer', async ({ page, request, browser }) => {
    const owner = await apiSignup(request)
    await loginWithToken(page, owner.token)
    await page.goto('/')
    const chat = await openChat(page)
    const dialogs = []
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss() })
    await say(chat, '<img src=x onerror="window.__xss=1;alert(1)"> talk to a person')
    await expect(chat.locator('.msg--user')).toContainText('<img src=x onerror=') // shown literally
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
    expect(dialogs).toHaveLength(0)
    await expect(chat.locator('.msg--bot', { hasText: /Ticket ZT/ })).toBeVisible()

    const otherPage = await (await browser.newContext()).newPage() // a different customer
    await loginWithToken(otherPage, (await apiSignup(request)).token)
    await otherPage.goto('/')
    const otherChat = await openChat(otherPage)
    await expect(otherChat.locator('.msg')).toHaveCount(1) // only the greeting: nothing from the first customer
    await expect(otherChat).not.toContainText('Ticket')
  })

  test('the Send button waits for a message, and Escape closes the chat', async ({ page }) => {
    await page.goto('/')
    const chat = await openChat(page)
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await chat.getByLabel('Message').fill('   ')
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled() // spaces alone do not count
    await chat.getByLabel('Message').press('Escape')
    await expect(chat).toBeHidden()
  })
})

test.describe('Support chat: a person takes over', () => {
  test('an agent replies from the admin inbox and the customer sees it in the same chat window', async ({ page, request, browser }) => {
    test.setTimeout(120_000)
    const admin = await adminSession(request)
    const user = await apiSignup(request, 'Meera Iyer')

    // the customer asks for a person
    await loginWithToken(page, user.token)
    await page.goto('/')
    const chat = await openChat(page)
    await say(chat, 'I want to talk to a person')
    await expect(chat.locator('.msg--bot', { hasText: /Ticket ZT\d{6}/ })).toBeVisible()
    const ticketId = (await chat.locator('.chat__head small').textContent()).match(/ZT\d{6}/)[0]

    // the agent finds it in the inbox and replies
    const agent = await (await browser.newContext()).newPage()
    await loginWithToken(agent, admin.token)
    await agent.goto('/admin/support')
    const ticket = agent.locator('.ticket', { hasText: 'Meera Iyer' })
    await expect(ticket.locator('.tstatus')).toHaveText('Needs reply')
    await ticket.click()
    await expect(agent.locator('.ticket__detail')).toContainText(user.email)
    await agent.getByLabel('Reply to customer').fill("Hi Meera, I'm looking into this right now.")
    await agent.getByRole('button', { name: 'Send reply' }).click()
    await expect(agent.locator('.toast', { hasText: 'Reply sent' })).toBeVisible()

    // ...and the customer sees it without refreshing (the chat checks for replies every few seconds)
    await expect(chat.locator('.msg--agent')).toContainText("I'm looking into this right now.", { timeout: 20_000 })
    await expect(chat.locator('.msg--agent .msg__who')).toHaveText('Support team')
    await expect(chat.locator('.chat__head')).toContainText('Our team replied')

    // the customer answers: the ticket goes back to "needs reply" for the team
    await say(chat, 'Thanks! The order never arrived.')
    await agent.getByRole('tab', { name: 'All' }).click()
    await expect(agent.locator('.ticket', { hasText: 'Meera Iyer' }).locator('.tstatus')).toHaveText('Needs reply', { timeout: 20_000 })

    // the agent resolves it; the customer is told
    await agent.locator('.ticket', { hasText: 'Meera Iyer' }).click()
    await agent.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(agent.locator('.toast', { hasText: 'Ticket resolved' })).toBeVisible()
    await expect(chat.locator('.chat__note', { hasText: 'marked resolved' })).toBeVisible({ timeout: 20_000 })

    // and a new message from the customer starts a brand-new conversation
    await say(chat, 'hello')
    await expect(chat.locator('.chat__head small')).not.toContainText(ticketId, { timeout: 15_000 })
    await expect(chat.locator('.chat__head small')).toContainText('Help assistant')
  })

  test('a new reply from our team shows a badge on the closed chat button', async ({ page, request }) => {
    test.setTimeout(90_000)
    const admin = await adminSession(request)
    const user = await apiSignup(request)
    const created = await request.post('/api/support/messages', { headers: user.auth, data: { text: 'I want to talk to a person' } })
    const ticketId = (await created.json()).id

    await loginWithToken(page, user.token)
    await page.goto('/')
    await expect(page.getByLabel('New reply from our team')).toHaveCount(0)
    const reply = await request.post(`/api/admin/support/threads/${ticketId}/reply`, { headers: admin.auth, data: { text: 'We are on it.' } })
    expect(reply.ok()).toBeTruthy()

    await expect(page.getByLabel('New reply from our team')).toBeVisible({ timeout: 35_000 }) // found by the background check
    const chat = await openChat(page)
    await expect(chat.locator('.msg--agent')).toContainText('We are on it.')
    await expect(page.getByLabel('New reply from our team')).toHaveCount(0) // opening the chat marks it as seen
  })
})
