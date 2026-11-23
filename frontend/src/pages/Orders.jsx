import { useState } from 'react'
import { Link } from 'react-router-dom'
import { bulkDeleteOrders, deleteOrder, isFinished, isUnpaid, listOrders, ORDER_STEPS } from '@/services/orderService'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/context/ToastContext'
import { useOrderStatus } from '@/hooks/useOrderStatus'
import ProductArt from '@/components/ProductArt'
import EmptyState from '@/components/EmptyState'
import { TrashIcon } from '@/components/Icons'
import { formatDate, formatPrice } from '@/utils/format'

function OrderRow({ order, onDeleted, selected, onToggle }) {
  const idx = useOrderStatus(order)
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const finished = idx === -1 || idx === ORDER_STEPS.length - 1 // only cancelled/delivered orders can be deleted
  const unpaid = isUnpaid(order) && !order.cancelled
  const label = idx === -1 ? 'Cancelled' : unpaid ? (order.paymentStatus === 'failed' ? 'Payment failed' : 'Awaiting payment') : ORDER_STEPS[idx].label

  const remove = async () => {
    try {
      await deleteOrder(order.id)
      onDeleted(order.id)
      toast('Order deleted')
    } catch (e) {
      toast(e.message, 'error')
      setConfirming(false)
    }
  }

  return (
    <div className={`order ${selected ? 'order--selected' : ''}`}>
      {finished && (
        <label className="order__check" title="Select for bulk delete">
          <input type="checkbox" checked={selected} onChange={() => onToggle(order.id)} aria-label={`Select order ${order.id}`} />
        </label>
      )}
      <Link to={`/orders/${order.id}`} className="order__link">
        <div className="order__top">
          <div><b>#{order.id}</b><span className="muted"> · {formatDate(order.createdAt)}</span></div>
          <span className={`status status--${idx === -1 ? 'cancelled' : unpaid ? 'warn' : finished ? 'done' : 'live'}`}>{label}</span>
        </div>
        <div className="order__items">
          {order.items.slice(0, 4).map((i) => <ProductArt key={i.id} product={i} size="xs" />)}
          <span className="muted">{order.items.map((i) => i.title).join(', ').slice(0, 80)}…</span>
          <b>{formatPrice(order.totals.total)}</b>
        </div>
      </Link>
      {finished && (
        <div className="order__foot">
          {confirming ? (
            <>
              <span className="muted">Delete this order permanently?</span>
              <button className="link-btn danger" onClick={remove}>Yes, delete</button>
              <button className="link-btn" onClick={() => setConfirming(false)}>Keep it</button>
            </>
          ) : (
            <button className="link-btn danger" onClick={() => setConfirming(true)}><TrashIcon width={16} height={16} /> Delete order</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Orders() {
  const { data, loading, error } = useAsync(listOrders, [])
  const { toast } = useToast()
  const [deleted, setDeleted] = useState([]) // ids removed this session: update the list instantly, no refetch
  const [selected, setSelected] = useState([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (loading) return <div className="page-loader"><span className="spinner" /></div>
  if (error) return <div className="container"><EmptyState emoji="⚠️" title="Couldn’t load orders" text={error.message} actionLabel="Back to home" to="/" /></div>
  const orders = data.filter((o) => !deleted.includes(o.id))
  const finishedIds = orders.filter(isFinished).map((o) => o.id)
  const chosen = selected.filter((id) => finishedIds.includes(id))
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const allSelected = finishedIds.length > 0 && chosen.length === finishedIds.length

  const deleteSelected = async () => {
    setBusy(true)
    try {
      const { deleted: done, skipped } = await bulkDeleteOrders(chosen)
      setDeleted((d) => [...d, ...done])
      setSelected([])
      toast(`Deleted ${done.length} order${done.length === 1 ? '' : 's'}`)
      if (skipped.length) toast(`${skipped.length} couldn’t be deleted: ${skipped[0].reason}`, 'error')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  if (!orders.length) return <div className="container"><EmptyState emoji="📦" title="No orders yet" text="When you place an order, it will show up here." /></div>
  return (
    <div className="container page narrow">
      <h1>My orders</h1>
      {finishedIds.length > 0 && (
        <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
          <label className="check">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : finishedIds)} />
            Select all delivered / cancelled ({finishedIds.length})
          </label>
          {chosen.length > 0 && (confirming ? (
            <span className="bulkbar__confirm">
              Delete {chosen.length} order{chosen.length === 1 ? '' : 's'} permanently?
              <button className="btn btn--sm btn--primary" onClick={deleteSelected} disabled={busy}>{busy ? 'Deleting…' : 'Yes, delete'}</button>
              <button className="link-btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            </span>
          ) : (
            <button className="btn btn--sm btn--ghost danger" onClick={() => setConfirming(true)}>
              <TrashIcon width={16} height={16} /> Delete selected ({chosen.length})
            </button>
          ))}
        </div>
      )}
      <div className="orders">
        {orders.map((o) => (
          <OrderRow key={o.id} order={o} selected={selected.includes(o.id)} onToggle={toggle}
                    onDeleted={(id) => { setDeleted((d) => [...d, id]); setSelected((s) => s.filter((x) => x !== id)) }} />
        ))}
      </div>
    </div>
  )
}
