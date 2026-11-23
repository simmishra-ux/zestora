import { api } from './api'

// Logged-in customers: a saved conversation (and a ticket if the bot hands over to a person).
export const getMyThread = () => api('/support/thread')
export const sendSupportMessage = (text) => api('/support/messages', { method: 'POST', body: { text } })
// Visitors who are not logged in: general answers only, nothing is saved.
export const askAsGuest = (text) => api('/support/ask', { method: 'POST', body: { text } })
