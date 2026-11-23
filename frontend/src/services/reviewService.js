import { api } from './api'

const base = (id) => `/products/${encodeURIComponent(id)}/reviews`
export const getReviews = (productId) => api(base(productId))
export const saveReview = (productId, review) => api(`${base(productId)}/me`, { method: 'PUT', body: review })
export const deleteReview = (productId) => api(`${base(productId)}/me`, { method: 'DELETE' })
