import { api } from './api'

// Every call resolves to the user's FULL updated address list (default first).
export const addAddress = (address) => api('/addresses', { method: 'POST', body: address })
export const editAddress = (id, address) => api(`/addresses/${encodeURIComponent(id)}`, { method: 'PUT', body: address })
export const deleteAddress = (id) => api(`/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const makeDefaultAddress = (id) => api(`/addresses/${encodeURIComponent(id)}/default`, { method: 'POST' })
