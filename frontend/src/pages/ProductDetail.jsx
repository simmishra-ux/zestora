import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCategory, getProduct, getRelated } from '@/services/productService'
import { useAsync } from '@/hooks/useAsync'
import { useCart } from '@/context/CartContext'
import ProductArt from '@/components/ProductArt'
import Rating from '@/components/Rating'
import Price from '@/components/Price'
import QuantityStepper from '@/components/QuantityStepper'
import WishlistButton from '@/components/WishlistButton'
import ProductGrid from '@/components/ProductGrid'
import SectionHeader from '@/components/SectionHeader'
import EmptyState from '@/components/EmptyState'
import Reviews from '@/components/Reviews'
import { CheckIcon, RefreshIcon, ShieldIcon, TruckIcon } from '@/components/Icons'
import { isPincode } from '@/utils/validators'

function DetailBody({ product, onReviewChanged }) {
  const { add } = useCart()
  const navigate = useNavigate()
  const [variant, setVariant] = useState(0)
  const [color, setColor] = useState(product.colors?.[0]?.name ?? null)
  const [qty, setQty] = useState(1)
  const [pin, setPin] = useState('')
  const [pinMsg, setPinMsg] = useState('')
  const related = useAsync(() => getRelated(product), [product.id])
  const category = getCategory(product.category)
  const out = product.stock === 0

  const checkPin = (e) => {
    e.preventDefault()
    if (!isPincode(pin)) return setPinMsg('Enter a valid 6-digit pincode.')
    const days = 2 + (Number(pin[5]) % 4)
    const d = new Date(Date.now() + days * 864e5).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    setPinMsg(`Delivery by ${d}`)
  }

  return (
    <div className="container detail">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link> / <Link to={`/products?category=${category.slug}`}>{category.name}</Link> / <span>{product.title}</span>
      </nav>

      <div className="detail__top">
        <div className="gallery">
          <div className="gallery__main"><ProductArt product={product} size="xl" variant={variant} /><WishlistButton product={product} className="card__wish" /></div>
          <div className="gallery__thumbs">
            {Array.from({ length: product.images?.length || 4 }, (_, v) => v).map((v) => (
              <button key={v} className={v === variant ? 'on' : ''} onClick={() => setVariant(v)} aria-label={`View ${v + 1}`}>
                <ProductArt product={product} size="xs" variant={v} />
              </button>
            ))}
          </div>
        </div>

        <div className="info">
          <span className="card__brand">{product.brand}</span>
          <h1>{product.title}</h1>
          <Rating value={product.rating} count={product.reviews} />
          <Price price={product.price} mrp={product.mrp} discount={product.discount} large />
          <small className="muted">Inclusive of all taxes</small>

          {product.colors?.length > 0 && (
          <div className="opt">
            <h4>Colour: <span>{color}</span></h4>
            <div className="swatches">
              {product.colors.map((c) => (
                <button key={c.name} className={c.name === color ? 'on' : ''} style={{ background: c.hex }} onClick={() => setColor(c.name)} aria-label={c.name} aria-pressed={c.name === color} />
              ))}
            </div>
          </div>
          )}

          <div className="opt">
            <h4>Quantity</h4>
            <QuantityStepper value={qty} onChange={setQty} max={Math.min(10, product.stock || 1)} />
            {!out && product.stock <= 5 && <small className="warn">Hurry — only {product.stock} left in stock!</small>}
          </div>

          <div className="info__cta">
            <button className="btn btn--soft btn--lg" disabled={out} onClick={() => add(product, qty, color)}>Add to cart</button>
            <button className="btn btn--primary btn--lg" disabled={out} onClick={() => { add(product, qty, color); navigate('/checkout') }}>
              {out ? 'Out of stock' : 'Buy now'}
            </button>
          </div>

          <form className="pin" onSubmit={checkPin}>
            <TruckIcon />
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter pincode" inputMode="numeric" aria-label="Pincode" />
            <button className="link-btn">Check</button>
            {pinMsg && <span className={isPincode(pin) ? 'ok' : 'warn'}>{pinMsg}</span>}
          </form>

          <ul className="assure">
            <li><ShieldIcon /> 1-year warranty</li>
            <li><RefreshIcon /> 7-day replacement</li>
            <li><TruckIcon /> Free delivery ₹499+</li>
          </ul>
        </div>
      </div>

      <div className="detail__sections">
        <section>
          <h2>About this product</h2>
          <p>{product.description}</p>
          <ul className="ticks">{product.highlights.map((h) => <li key={h}><CheckIcon width={18} height={18} /> {h}</li>)}</ul>
          {Object.keys(product.specs ?? {}).length > 0 && (
            <>
              <h3 className="specs__title">Specifications</h3>
              <dl className="specs">
                {Object.entries(product.specs).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </>
          )}
        </section>
        <Reviews product={product} onChanged={onReviewChanged} />
      </div>

      <SectionHeader eyebrow="You may also like" title="Similar products" linkTo={`/products?category=${category.slug}`} />
      <ProductGrid products={related.data ?? []} loading={related.loading} skeletons={4} />
    </div>
  )
}

export default function ProductDetail() {
  const { id } = useParams()
  const [version, setVersion] = useState(0) // bumped after a review is saved, to refetch the new average rating
  const { data, loading, error } = useAsync(() => getProduct(id), [id, version])
  if (loading && !data) return <div className="container"><div className="skeleton" style={{ height: 480, borderRadius: 24, marginTop: 24 }} /></div>
  if (error) return <EmptyState emoji="🫥" title="Product not found" text="It may have been removed or the link is wrong." />
  // `key` resets local state (selected colour, qty…) when navigating between products.
  return <DetailBody key={data.id} product={data} onReviewChanged={() => setVersion((v) => v + 1)} />
}
