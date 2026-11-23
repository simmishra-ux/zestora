import { useEffect, useState } from 'react'
import { confirmPayment, createIntent } from '@/services/paymentService'
import { getOrder } from '@/services/orderService'
import { formatPrice } from '@/utils/format'
import { CloseIcon } from './Icons'

const CARD_TESTS = [
  { label: '✓ Success', number: '4242 4242 4242 4242' },
  { label: '✗ Declined', number: '4000 0000 0000 0002' },
  { label: '✗ No funds', number: '4000 0000 0000 9995' },
]
const UPI_TESTS = [{ label: '✓ Success', vpa: 'success@upi' }, { label: '✗ Declined', vpa: 'fail@upi' }]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A MOCK of the "hosted payment page" that Stripe/Razorpay show. The page collects details and sends them
// to the gateway; it then waits for OUR server to confirm via the signed webhook (we poll the order).
export default function GatewayModal({ order, onPaid, onClose }) {
  const method = order.paymentMethod // 'upi' | 'card'
  const [intent, setIntent] = useState(null)
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '' })
  const [vpa, setVpa] = useState('')
  const [phase, setPhase] = useState('form') // form | paying | success
  const [message, setMessage] = useState('')
  const busy = phase !== 'form'

  const startIntent = () => {
    setIntent(null)
    return createIntent(order.id).then(setIntent).catch((e) => setMessage(e.message))
  }
  useEffect(() => {
    let cancelled = false
    createIntent(order.id).then((i) => !cancelled && setIntent(i)).catch((e) => !cancelled && setMessage(e.message))
    return () => {
      cancelled = true
    }
  }, [order.id])

  const pay = async (e) => {
    e.preventDefault()
    setMessage('')
    setPhase('paying')
    try {
      const res = await confirmPayment(intent, method, method === 'card' ? { cardNumber: card.number, expiry: card.expiry, cvv: card.cvv } : { vpa })
      if (res.status === 'failed') {
        setMessage(res.message)
        setPhase('form')
        startIntent() // a failed intent is finished; a retry needs a fresh one
        return
      }
      setPhase('success')
      // The browser's word isn't proof. Wait until OUR server has seen the signed webhook and marked the order paid.
      for (let i = 0; i < 8; i += 1) {
        if ((await getOrder(order.id)).paymentStatus === 'paid') break
        await sleep(400)
      }
      await sleep(700)
      onPaid(res.emailStatus)
    } catch (err) {
      setMessage(err.message) // e.g. 422 "Enter a valid 16-digit card number" (the intent is still usable)
      setPhase('form')
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Secure payment">
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="modal__card gateway">
        <header className="gateway__head">
          <span>🔒 Zestora Pay <em>TEST MODE</em></span>
          {!busy && <button className="icon-btn" onClick={onClose} aria-label="Close payment window"><CloseIcon /></button>}
        </header>

        {phase === 'success' ? (
          <div className="gateway__done"><div className="success__check">✓</div><h2>Payment successful</h2><p className="muted">Confirming your order…</p></div>
        ) : (
          <form onSubmit={pay} noValidate>
            <div className="gateway__amount">Pay <b>{formatPrice(order.totals.total)}</b><small>Order #{order.id} · {method === 'card' ? 'Card' : 'UPI'}</small></div>
            {message && <div className="alert" role="alert">{message}</div>}

            {method === 'card' ? (
              <div className="form-grid">
                <div className="span2 field"><label htmlFor="gw-card">Card number</label>
                  <input id="gw-card" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" value={card.number}
                         onChange={(e) => setCard({ ...card, number: e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim() })} /></div>
                <div className="field"><label htmlFor="gw-exp">Expiry</label>
                  <input id="gw-exp" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={card.expiry}
                         onChange={(e) => setCard({ ...card, expiry: e.target.value.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2') })} /></div>
                <div className="field"><label htmlFor="gw-cvv">CVV</label>
                  <input id="gw-cvv" type="password" inputMode="numeric" autoComplete="cc-csc" value={card.cvv}
                         onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></div>
              </div>
            ) : (
              <div className="field"><label htmlFor="gw-vpa">UPI ID</label>
                <input id="gw-vpa" placeholder="name@bank" autoComplete="off" value={vpa} onChange={(e) => setVpa(e.target.value.trim())} /></div>
            )}

            <div className="gateway__tests">
              <span>Test {method === 'card' ? 'cards' : 'UPI IDs'} <small>(any future expiry, any CVV)</small></span>
              <div>
                {method === 'card'
                  ? CARD_TESTS.map((t) => <button key={t.number} type="button" onClick={() => setCard({ number: t.number, expiry: '12/39', cvv: '123' })}>{t.label}</button>)
                  : UPI_TESTS.map((t) => <button key={t.vpa} type="button" onClick={() => setVpa(t.vpa)}>{t.label}</button>)}
              </div>
            </div>

            <button className="btn btn--primary btn--lg btn--block" disabled={!intent || busy}>
              {phase === 'paying' ? <><span className="spinner spinner--sm" /> Processing…</> : !intent && !message ? 'Preparing secure payment…' : `Pay ${formatPrice(order.totals.total)}`}
            </button>
            <button type="button" className="link-btn gateway__later" onClick={onClose} disabled={busy}>Pay later (order is held for 15 minutes)</button>
          </form>
        )}
      </div>
    </div>
  )
}
