import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext'
import ProductArt from '@/components/ProductArt'
import QuantityStepper from '@/components/QuantityStepper'
import EmptyState from '@/components/EmptyState'
import Price from '@/components/Price'
import OrderSummary from '@/components/OrderSummary'
import CouponPanel from '@/components/CouponPanel'
import { TrashIcon } from '@/components/Icons'
import { FREE_DELIVERY_THRESHOLD } from '@/utils/pricing'

export default function Cart() {
  const { lines, totals, setQty, remove, MAX_QTY } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  if (lines.length === 0)
    return <div className="container"><EmptyState emoji="🛒" title="Your cart is empty" text="Looks like you haven’t added anything yet." /></div>

  const toFree = FREE_DELIVERY_THRESHOLD - (totals.subtotal - totals.couponDiscount)

  return (
    <div className="container page">
      <h1>Shopping cart <span className="muted">({totals.itemCount} items)</span></h1>
      <div className="two-col">
        <div>
          <div className="freebar">
            {toFree > 0 ? <>Add <b>₹{toFree}</b> more for <b>free delivery</b></> : <>🎉 You’ve unlocked <b>free delivery</b></>}
            <div className="freebar__track"><span style={{ width: `${Math.min(100, ((totals.subtotal - totals.couponDiscount) / FREE_DELIVERY_THRESHOLD) * 100)}%` }} /></div>
          </div>
          <ul className="lines">
            {lines.map(({ product, qty, color }) => (
              <li key={product.id} className="line">
                <Link to={`/products/${product.id}`}><ProductArt product={product} size="sm" /></Link>
                <div className="line__info">
                  <Link to={`/products/${product.id}`}><h3>{product.title}</h3></Link>
                  <span className="muted">{product.brand}{color ? ` · ${color}` : ''}</span>
                  <Price price={product.price} mrp={product.mrp} discount={product.discount} />
                  <div className="line__actions">
                    <QuantityStepper value={qty} max={MAX_QTY} onChange={(q) => setQty(product.id, q)} />
                    <button className="link-btn danger" onClick={() => remove(product.id)}><TrashIcon width={16} height={16} /> Remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside className="summary-col">
          <CouponPanel />
          <OrderSummary totals={totals} />
          <button className="btn btn--primary btn--lg btn--block" onClick={() => navigate(user ? '/checkout' : '/login', { state: { from: '/checkout' } })}>
            {user ? 'Proceed to checkout' : 'Login to checkout'}
          </button>
        </aside>
      </div>
    </div>
  )
}
