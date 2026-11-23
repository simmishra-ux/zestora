import { api } from './api'

export const getStats = () => api('/admin/stats')
export const adminProducts = ({ q, lowStock, visibility } = {}) =>
  api('/admin/products', { params: { q, lowStock, visibility: visibility === 'all' ? undefined : visibility } })
export const createProduct = (p) => api('/admin/products', { method: 'POST', body: p })
export const updateProduct = (id, p) => api(`/admin/products/${encodeURIComponent(id)}`, { method: 'PUT', body: p })
export const removeProduct = (id) => api(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const adminOrders = (status) => api('/admin/orders', { params: { status: status === 'all' ? undefined : status } })
export const setOrderStatus = (id, status) => api(`/admin/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } })

export const adminCoupons = () => api('/admin/coupons')
export const createCoupon = (c) => api('/admin/coupons', { method: 'POST', body: c })
export const updateCoupon = (code, c) => api(`/admin/coupons/${encodeURIComponent(code)}`, { method: 'PUT', body: c })
export const removeCoupon = (code) => api(`/admin/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' })

export const supportThreads = (status) => api('/admin/support/threads', { params: { status: status === 'all' ? undefined : status } })
export const supportThread = (id) => api(`/admin/support/threads/${encodeURIComponent(id)}`)
export const supportReply = (id, text) => api(`/admin/support/threads/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { text } })
export const supportAction = (id, action) => api(`/admin/support/threads/${encodeURIComponent(id)}/action`, { method: 'POST', body: { action } })
