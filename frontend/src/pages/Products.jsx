import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getCategories, getCategory, getProducts, getSubcategories, getSubcategory, PRICE_MAX, SORT_OPTIONS } from '@/services/productService'
import { useAsync } from '@/hooks/useAsync'
import FilterPanel from '@/components/FilterPanel'
import ProductGrid from '@/components/ProductGrid'
import EmptyState from '@/components/EmptyState'
import { CloseIcon, FilterIcon } from '@/components/Icons'

const PAGE_SIZE = 12

// The URL is the single source of truth for filters. That makes results shareable,
// bookmarkable, and makes the browser Back button "just work".
function parseParams(sp) {
  return {
    q: sp.get('q') || '',
    category: sp.get('category') || '',
    sub: sp.get('sub') || '',
    sort: sp.get('sort') || 'relevance',
    brands: sp.getAll('brand'),
    maxPrice: Number(sp.get('max')) || PRICE_MAX,
    minRating: Number(sp.get('rating')) || 0,
    minDiscount: Number(sp.get('discount')) || 0,
    inStock: sp.get('stock') === '1',
  }
}

export default function Products() {
  const [sp, setSp] = useSearchParams()
  const [showFilters, setShowFilters] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const filters = useMemo(() => parseParams(sp), [sp])

  const update = (patch) => {
    const f = { ...filters, ...patch }
    const next = new URLSearchParams()
    if (f.q) next.set('q', f.q)
    if (f.category) next.set('category', f.category)
    if (f.sub) next.set('sub', f.sub)
    if (f.sort !== 'relevance') next.set('sort', f.sort)
    f.brands.forEach((b) => next.append('brand', b))
    if (f.maxPrice < PRICE_MAX) next.set('max', f.maxPrice)
    if (f.minRating) next.set('rating', f.minRating)
    if (f.minDiscount) next.set('discount', f.minDiscount)
    if (f.inStock) next.set('stock', '1')
    setSp(next, { replace: true })
    setVisible(PAGE_SIZE)
  }
  const reset = () => setSp(filters.q || filters.category ? Object.fromEntries(Object.entries({ q: filters.q, category: filters.category, sub: filters.sub }).filter(([, v]) => v)) : {}, { replace: true })

  const { data, loading } = useAsync(() => getProducts(filters), [sp.toString()])
  const products = data ?? []
  const category = getCategory(filters.category)
  const subs = getSubcategories(filters.category)
  const sub = getSubcategory(filters.sub)

  const chips = [
    filters.q && { label: `“${filters.q}”`, clear: { q: '' } },
    category && { label: category.name, clear: { category: '', sub: '' } },
    sub && { label: sub.name, clear: { sub: '' } },
    ...filters.brands.map((b) => ({ label: b, clear: { brands: filters.brands.filter((x) => x !== b) } })),
    filters.maxPrice < PRICE_MAX && { label: `Under ₹${filters.maxPrice.toLocaleString('en-IN')}`, clear: { maxPrice: PRICE_MAX } },
    filters.minRating && { label: `${filters.minRating}★+`, clear: { minRating: 0 } },
    filters.minDiscount && { label: `${filters.minDiscount}%+ off`, clear: { minDiscount: 0 } },
    filters.inStock && { label: 'In stock', clear: { inStock: false } },
  ].filter(Boolean)

  return (
    <div className="container listing">
      <aside className={`listing__filters ${showFilters ? 'is-open' : ''}`}>
        <button className="listing__close icon-btn" onClick={() => setShowFilters(false)} aria-label="Close filters"><CloseIcon /></button>
        <FilterPanel filters={filters} onChange={update} onReset={reset} />
        <button className="btn btn--primary btn--block listing__apply" onClick={() => setShowFilters(false)}>
          Show {loading ? '…' : products.length} results
        </button>
      </aside>
      {showFilters && <div className="scrim" onClick={() => setShowFilters(false)} />}

      <section className="listing__main">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link> / <span>{category ? category.name : filters.q ? 'Search' : 'All products'}</span>
        </nav>
        <div className="listing__bar">
          <div>
            <h1>{sub ? sub.name : category ? category.name : filters.q ? `Results for “${filters.q}”` : 'All products'}</h1>
            <span className="muted">{loading ? 'Loading…' : `${products.length} products`}</span>
          </div>
          <div className="listing__tools">
            <button className="btn btn--ghost btn--sm listing__filter-btn" onClick={() => setShowFilters(true)}>
              <FilterIcon width={18} height={18} /> Filters{chips.length ? ` (${chips.length})` : ''}
            </button>
            <label className="select">
              <span className="sr-only">Sort by</span>
              <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="cat-scroll">
          <button className={!filters.category ? 'on' : ''} onClick={() => update({ category: '', sub: '' })}>All</button>
          {getCategories().map((c) => (
            <button key={c.slug} className={filters.category === c.slug ? 'on' : ''} onClick={() => update({ category: c.slug, sub: '' })}>{c.emoji} {c.name}</button>
          ))}
        </div>

        {subs.length > 1 && (
          <div className="cat-scroll cat-scroll--sub" aria-label={`${category.name} sections`}>
            <button className={!filters.sub ? 'on' : ''} onClick={() => update({ sub: '' })}>All {category.name}</button>
            {subs.map((s) => (
              <button key={s.slug} className={filters.sub === s.slug ? 'on' : ''} onClick={() => update({ sub: s.slug })}>{s.name}</button>
            ))}
          </div>
        )}

        {chips.length > 0 && (
          <div className="chips">
            {chips.map((c) => (
              <button key={c.label} className="chip" onClick={() => update(c.clear)}>{c.label} <CloseIcon width={14} height={14} /></button>
            ))}
          </div>
        )}

        {!loading && products.length === 0 ? (
          <EmptyState emoji="🔍" title="No products match" text="Try removing a filter or searching for something else." actionLabel="Clear filters" to="/products" />
        ) : (
          <>
            <ProductGrid products={products.slice(0, visible)} loading={loading} skeletons={PAGE_SIZE} />
            {!loading && visible < products.length && (
              <div className="center">
                <button className="btn btn--ghost btn--lg" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                  Load more ({products.length - visible} left)
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
