import { useState } from 'react'
import { useCart } from '@/context/CartContext'
import { formatPrice } from '@/utils/format'

// "Offers & coupons" box, used on the Cart page and on the checkout's payment step.
export default function CouponPanel({ compact = false }) {
  const { offers, applied, couponCode, applyCoupon, removeCoupon, offersLoading } = useCart()
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState(null) // { ok, message } from the last "Apply" click
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? offers : offers.slice(0, compact ? 3 : 4)

  const apply = (c) => {
    const res = applyCoupon(c)
    setMsg(res)
    if (res.ok) setCode('')
  }

  return (
    <section className="coupons" aria-label="Offers and coupons">
      <h3>🏷️ Offers & coupons</h3>

      {applied && (
        <div className="coupon-applied" role="status">
          <span>✓ <b>{applied.code}</b> applied · you save <b>{formatPrice(applied.discount)}</b></span>
          <button className="link-btn" onClick={() => { removeCoupon(); setMsg(null) }}>Remove</button>
        </div>
      )}

      <form className="coupon" onSubmit={(e) => { e.preventDefault(); apply(code) }}>
        <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setMsg(null) }} placeholder="Have a code? Enter it here" aria-label="Coupon code" maxLength={20} />
        <button className="btn btn--soft btn--sm" type="submit">Apply</button>
      </form>
      {msg && <p className={msg.ok ? 'ok' : 'warn'} role="alert">{msg.message}</p>}

      {offersLoading && offers.length === 0 && <div className="skeleton" style={{ height: 72 }} />}
      <ul className="offers">
        {visible.map((o) => {
          const isApplied = couponCode === o.code && o.eligible
          return (
            <li key={o.code} className={`offer ${o.eligible ? '' : 'offer--off'} ${isApplied ? 'offer--on' : ''}`}>
              <div className="offer__code">{o.code}</div>
              <div className="offer__body">
                <b>{o.title}{o.best && !isApplied && <span className="offer__best">Best offer</span>}</b>
                <span className="muted">{o.description}</span>
                {o.eligible
                  ? <span className="offer__save">You save {formatPrice(o.discount)}</span>
                  : <span className="offer__why">{o.reason}</span>}
                {o.terms.length > 0 && <small className="offer__terms">{o.terms.join(' · ')}</small>}
              </div>
              {isApplied
                ? <button className="link-btn danger" onClick={() => { removeCoupon(); setMsg(null) }}>Remove</button>
                : <button className="btn btn--soft btn--sm" disabled={!o.eligible} onClick={() => apply(o.code)}>Apply</button>}
            </li>
          )
        })}
      </ul>
      {offers.length > visible.length && <button className="link-btn" onClick={() => setShowAll(true)}>View all {offers.length} offers</button>}
    </section>
  )
}
