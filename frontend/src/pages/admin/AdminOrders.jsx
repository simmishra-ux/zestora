import { useState } from 'react'
import { adminOrders, setOrderStatus } from '@/services/adminService'
import { getStatusIndex, isUnpaid, ORDER_STEPS, PAYMENT_LABELS } from '@/services/orderService'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/context/ToastContext'
import { formatDate, formatPrice } from '@/utils/format'

const FILTERS = [{ key: 'all', label: 'All' }, ...ORDER_STEPS.map((s) => ({ key: s.key, label: s.label })), { key: 'cancelled', label: 'Cancelled' }]

function OrderCard({ order, onChanged }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const idx = getStatusIndex(order)
  const current = idx === -1 ? 'cancelled' : ORDER_STEPS[idx].key

  const change = async (status) => {
    if (status === 'cancelled' && !window.confirm('Cancel this order? Stock will be restored.')) return
    setBusy(true)
    try {
      onChanged(await setOrderStatus(order.id, status))
      toast(`Order #${order.id} → ${status === 'cancelled' ? 'Cancelled' : ORDER_STEPS.find((s) => s.key === status).label}`)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="aorder">
      <header>
        <div><b>#{order.id}</b><span className="muted"> · {formatDate(order.createdAt)}</span></div>
        <b>{formatPrice(order.totals.total)}</b>
      </header>
      <p><span className={`pay pay--${order.paymentStatus}`}>{PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}</span></p>
      <p className="aorder__who">{order.customerName} · <span className="muted">{order.customerEmail}</span></p>
      <ul className="aorder__items">
        {order.items.map((i) => <li key={i.id}>{i.emoji} {i.qty} × {i.title}</li>)}
      </ul>
      <p className="muted aorder__addr">📍 {order.address.line1}, {order.address.city} – {order.address.pincode} · {order.paymentMethod.toUpperCase()}</p>
      <footer>
        <label>Status
          <select value={current} disabled={busy || order.cancelled || isUnpaid(order)} onChange={(e) => change(e.target.value)} aria-label={`Status of order ${order.id}`}>
            {ORDER_STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        {order.adminStatus && <small className="muted">set by admin</small>}
        {isUnpaid(order) && !order.cancelled && <small className="muted">waiting for payment</small>}
      </footer>
    </article>
  )
}

export default function AdminOrders() {
  const [filter, setFilter] = useState('all')
  const [local, setLocal] = useState({}) // orders updated this session, keyed by id (instant UI without refetching)
  // Always fetch ALL once and filter in the browser: status is computed from time, so it keeps changing under us.
  const { data, loading, error } = useAsync(() => adminOrders('all'), [])
  if (error) return <p className="alert">{error.message}</p>
  if (loading && !data) return <div className="page-loader"><span className="spinner" /></div>

  const orders = data.map((o) => local[o.id] ?? o)
  const keyOf = (o) => { const i = getStatusIndex(o); return i === -1 ? 'cancelled' : ORDER_STEPS[i].key }
  const shown = orders.filter((o) => filter === 'all' || keyOf(o) === filter)

  return (
    <>
      <div className="chips admin-filters" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => {
          const n = f.key === 'all' ? orders.length : orders.filter((o) => keyOf(o) === f.key).length
          return <button key={f.key} role="tab" aria-selected={filter === f.key} className={`chip ${filter === f.key ? 'chip--on' : ''}`} onClick={() => setFilter(f.key)}>{f.label} ({n})</button>
        })}
      </div>
      {shown.length === 0 ? <p className="muted">No orders in this view.</p> : (
        <div className="aorders">{shown.map((o) => <OrderCard key={o.id} order={o} onChanged={(u) => setLocal((l) => ({ ...l, [u.id]: u }))} />)}</div>
      )}
    </>
  )
}
