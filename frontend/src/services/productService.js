// Data-access layer, now backed by the FastAPI backend. Component code is unchanged from the mock version.
import { api } from './api'
import { BRANDS, CATEGORIES, PRICE_MAX, SUBCATEGORIES } from '@/data/catalog'

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Customer Rating' },
  { value: 'discount', label: 'Biggest Discount' },
  { value: 'newest', label: 'Newest First' },
]

export function getProducts({ q, category, sub, brands, minPrice, maxPrice, minRating, minDiscount, inStock, sort } = {}) {
  return api('/products', {
    params: { q, category, sub, brand: brands, minPrice, maxPrice: maxPrice < PRICE_MAX ? maxPrice : undefined, minRating, minDiscount, inStock, sort },
  })
}

export const getProduct = (id) => api(`/products/${encodeURIComponent(id)}`)

export const getProductsByIds = (ids) => (ids.length ? api('/products', { params: { ids } }) : Promise.resolve([]))

export async function getRelated(product, limit = 4) {
  const items = await api('/products', { params: { category: product.category, sort: 'relevance', limit: limit + 1 } })
  return items.filter((p) => p.id !== product.id).slice(0, limit)
}

export async function getHomeCollections() {
  const [trending, deals, topRated, newArrivals] = await Promise.all([
    api('/products', { params: { sort: 'relevance', limit: 10 } }),
    api('/products', { params: { sort: 'discount', inStock: true, limit: 10 } }),
    api('/products', { params: { sort: 'rating', limit: 5 } }),
    api('/products', { params: { sort: 'newest', limit: 5 } }),
  ])
  return { trending, deals, topRated, newArrivals }
}

export const suggest = (q, limit = 6) => (q.trim() ? api('/products', { params: { q, limit } }) : Promise.resolve([]))

export const getCategories = () => CATEGORIES
export const getBrands = () => BRANDS
export const getCategory = (slug) => CATEGORIES.find((c) => c.slug === slug)
export const getSubcategories = (category) => SUBCATEGORIES.filter((s) => s.category === category)
export const getSubcategory = (slug) => SUBCATEGORIES.find((s) => s.slug === slug)
export { PRICE_MAX }
