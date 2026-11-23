import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { suggest } from '@/services/productService'
import { useDebounce } from '@/hooks/useDebounce'
import { SearchIcon } from './Icons'
import ProductArt from './ProductArt'
import VoiceSearch from './VoiceSearch'

export default function SearchBox() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const urlQuery = params.get('q') || ''
  const [value, setValue] = useState(urlQuery)
  // Keep the input in step with the URL (Back button, clicking a category...). React's recommended pattern:
  // adjust state DURING render when a prop-like input changes, instead of an effect that causes a second render.
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery)
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery)
    setValue(urlQuery)
  }
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef(null)
  const debounced = useDebounce(value, 150)
  const [fetched, setFetched] = useState({ q: '', items: [] }) // the latest answer, tagged with the query it answers
  const term = debounced.trim()

  useEffect(() => {
    if (!open || !term) return
    let cancelled = false
    suggest(term)
      .then((items) => !cancelled && setFetched({ q: term, items }))
      .catch(() => !cancelled && setFetched({ q: term, items: [] }))
    return () => {
      cancelled = true
    }
  }, [term, open])

  // Derived, never stored: show suggestions only while open AND only if they answer the current query.
  const results = open && term && fetched.q === term ? fetched.items : []

  useEffect(() => {
    const onDown = (e) => wrapRef.current && !wrapRef.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const go = (q) => {
    setOpen(false)
    navigate(q.trim() ? `/products?q=${encodeURIComponent(q.trim())}` : '/products')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)) }
    else if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      setOpen(false)
      navigate(`/products/${results[active].id}`)
    }
  }

  return (
    <div className="search" ref={wrapRef}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); go(value) }}>
        <SearchIcon width={20} height={20} />
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setOpen(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search for products, brands and more"
          aria-label="Search products"
          autoComplete="off"
        />
        <VoiceSearch onResult={(query) => { setValue(query); go(query) }} />
        <button type="submit" className="btn btn--primary btn--sm">Search</button>
      </form>
      {results.length > 0 && (
        <ul className="search__list" role="listbox">
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
                onMouseDown={() => navigate(`/products/${p.id}`)}>
              <ProductArt product={p} size="xs" />
              <span>{p.title}<small>in {p.category}</small></span>
            </li>
          ))}
          <li className="search__all" onMouseDown={() => go(value)}>See all results for “{value}”</li>
        </ul>
      )}
    </div>
  )
}
