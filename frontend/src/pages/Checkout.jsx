import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useCart } from '@/context/CartContext'
import { useToast } from '@/context/ToastContext'
import { createOrder } from '@/services/orderService'
import { addAddress } from '@/services/addressService'
import Field from '@/components/Field'
import AddressForm from '@/components/AddressForm'
import { EMPTY_ADDRESS } from '@/utils/address'
import OrderSummary from '@/components/OrderSummary'
import CouponPanel from '@/components/CouponPanel'
import GatewayModal from '@/components/GatewayModal'
import ProductArt from '@/components/ProductArt'
import { formatPrice } from '@/utils/format'
import { isEmail, validateAddress } from '@/utils/validators'

const STEPS = ['Address', 'Payment', 'Review']
const PAYMENTS = [
  { id: 'upi', label: 'UPI', hint: 'Pay with any UPI app' },
  { id: 'card', label: 'Credit / Debit card', hint: 'Visa, Mastercard, RuPay' },
  { id: 'cod', label: 'Cash on delivery', hint: 'Pay when it arrives' },
]

export default function Checkout() {
  const { user, setAddresses } = useAuth()
  const { lines, totals, couponCode, clear, setPaymentMethod } = useCart()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  // Where the confirmation email goes. Defaults to the account email but can be changed (e.g. a Gmail address).
  const [email, setEmail] = useState(user.email)
  const [selected, setSelected] = useState(user.addresses[0]?.id ?? 'new')
  const [addr, setAddr] = useState({ ...EMPTY_ADDRESS, name: user.name, phone: user.phone })
  const [pay, setPay] = useState('upi')
  const [errors, setErrors] = useState({})
  const [placing, setPlacing] = useState(false)
  const [payingOrder, setPayingOrder] = useState(null) // set after an ONLINE order is created: opens the gateway window

  // Some coupons only work with certain payment methods, so the cart needs to know the current choice.
  useEffect(() => {
    setPaymentMethod(step >= 1 ? pay : null)
  }, [step, pay, setPaymentMethod])
  useEffect(() => () => setPaymentMethod(null), [setPaymentMethod]) // leaving checkout: forget the choice

  if (lines.length === 0 && !placing && !payingOrder) return <Navigate to="/cart" replace />

  const savedAddr = user.addresses.find((a) => a.id === selected)

  const nextFromAddress = () => {
    const e = {}
    if (!isEmail(email.trim())) e.email = 'Enter a valid email address.'
    if (selected !== 'new') {
      setErrors(e)
      if (!Object.keys(e).length) setStep(1)
      return
    }
    Object.assign(e, validateAddress(addr))
    setErrors(e)
    if (!Object.keys(e).length) setStep(1)
  }

  const place = async () => {
    setPlacing(true)
    let address = savedAddr
    try {
      if (selected === 'new') {
        // Save it to the address book first; the server returns the updated list and we find the new entry.
        const known = new Set(user.addresses.map((a) => a.id))
        const list = await addAddress(addr)
        setAddresses(list)
        address = list.find((a) => !known.has(a.id))
      }
    } catch (err) {
      setPlacing(false)
      toast(err.message, 'error')
      return
    }
    let order
    try {
      order = await createOrder({ lines, address, paymentMethod: pay, couponCode, email: email.trim() })
    } catch (err) {
      setPlacing(false)
      toast(err.message, 'error')
      return
    }
    clear() // the order now exists (and holds its stock), so the cart is done
    if (pay === 'cod') {
      toast('Order placed successfully 🎉')
      navigate(`/orders/${order.id}`, { replace: true, state: { placed: true, emailStatus: order.emailStatus } })
      return
    }
    setPlacing(false)
    setPayingOrder(order) // online payment: the order is "pending" until the gateway's signed webhook says paid
  }

  return (
    <div className="container page">
      <h1>Checkout</h1>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}><span>{i < step ? '✓' : i + 1}</span>{s}</li>
        ))}
      </ol>

      <div className="two-col">
        <div className="panel">
          {step === 0 && (
            <>
              <h2>Delivery address</h2>
              <div className="addr-list">
                {user.addresses.map((a) => (
                  <label key={a.id} className={`option ${selected === a.id ? 'on' : ''}`}>
                    <input type="radio" checked={selected === a.id} onChange={() => setSelected(a.id)} />
                    <div>
                      <b>{a.name}</b> · {a.phone} <span className="tag-label">{a.label}</span>{a.isDefault && <span className="tag-label tag-label--default">Default</span>}
                      <br /><span className="muted">{a.line1}, {a.city}, {a.state} – {a.pincode}</span>
                    </div>
                  </label>
                ))}
                <label className={`option ${selected === 'new' ? 'on' : ''}`}>
                  <input type="radio" checked={selected === 'new'} onChange={() => setSelected('new')} />
                  <b>+ Add a new address</b>
                </label>
              </div>
              {selected === 'new' && <AddressForm value={addr} onChange={setAddr} errors={errors} showDefault={user.addresses.length > 0} />}
              <p className="muted">New addresses are saved to your address book. <Link to="/profile" className="link-btn">Manage addresses</Link></p>
              <Field label="Email for order confirmation" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email}
                     hint="We’ll send your order details here." autoComplete="email" />
              <div className="btn-row">
                <button className="btn btn--ghost btn--lg" onClick={() => navigate('/cart')}>Back to cart</button>
                <button className="btn btn--primary btn--lg" onClick={nextFromAddress}>Deliver here</button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Payment method</h2>
              <p className="muted">Test mode — no real money moves. You’ll pay on a secure payment window after placing the order.</p>
              <div className="addr-list">
                {PAYMENTS.map((p) => (
                  <label key={p.id} className={`option ${pay === p.id ? 'on' : ''}`}>
                    <input type="radio" checked={pay === p.id} onChange={() => { setPay(p.id); setErrors({}) }} />
                    <div><b>{p.label}</b><br /><span className="muted">{p.hint}</span></div>
                  </label>
                ))}
              </div>
              {pay !== 'cod' && <p className="hint-box">💳 {pay === 'card' ? 'Card' : 'UPI'} details are entered on the payment window, not on this page. Your order is held for 15 minutes while you pay.</p>}
              <CouponPanel compact />
              <div className="btn-row">
                <button className="btn btn--ghost btn--lg" onClick={() => setStep(0)}>Back</button>
                <button className="btn btn--primary btn--lg" onClick={() => setStep(2)}>Review order</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Review your order</h2>
              <ul className="mini-lines">
                {lines.map(({ product, qty }) => (
                  <li key={product.id}><ProductArt product={product} size="xs" /><span>{product.title}<small>Qty {qty}</small></span><b>{formatPrice(product.price * qty)}</b></li>
                ))}
              </ul>
              <div className="review-box">
                <div><h4>Deliver to</h4>{(savedAddr || addr).name}, {(savedAddr || addr).line1}, {(savedAddr || addr).city} – {(savedAddr || addr).pincode}</div>
                <div><h4>Confirmation email</h4>{email.trim()}</div>
                <div><h4>Payment</h4>{PAYMENTS.find((p) => p.id === pay).label}{couponCode && <><br /><span className="green">Coupon {couponCode} applied</span></>}</div>
              </div>
              <div className="btn-row">
                <button className="btn btn--ghost btn--lg" onClick={() => setStep(1)} disabled={placing}>Back</button>
                <button className="btn btn--primary btn--lg" onClick={place} disabled={placing}>
                  {placing ? <><span className="spinner spinner--sm" /> Placing order…</> : pay === 'cod' ? `Place order · ${formatPrice(totals.total)}` : `Place order & pay ${formatPrice(totals.total)}`}
                </button>
              </div>
            </>
          )}
        </div>
        <aside className="summary-col"><OrderSummary totals={totals} /></aside>
      </div>
      {payingOrder && (
        <GatewayModal
          order={payingOrder}
          onPaid={(emailStatus) => {
            toast('Payment successful 🎉')
            navigate(`/orders/${payingOrder.id}`, { replace: true, state: { placed: true, emailStatus } })
          }}
          onClose={() => {
            toast('Order placed. Complete the payment within 15 minutes.')
            navigate(`/orders/${payingOrder.id}`, { replace: true, state: { placed: true } })
          }}
        />
      )}
    </div>
  )
}
