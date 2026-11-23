import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/context/ToastContext'
import { cancelOrder, deleteOrder, getOrder, isUnpaid, ORDER_STEPS, PAYMENT_LABELS } from '@/services/orderService'
import GatewayModal from '@/components/GatewayModal'
import OrderTracker from '@/components/OrderTracker'
import { useOrderStatus } from '@/hooks/useOrderStatus'
import ProductArt from '@/components/ProductArt'
import OrderSummary from '@/components/OrderSummary'
import EmptyState from '@/components/EmptyState'
import { formatDate, formatPrice } from '@/utils/format'

function Detail({ initial }) {
  const [order, setOrder] = useState(initial)
  const idx = useOrderStatus(order)
  const { state } = useLocation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [paying, setPaying] = useState(false)
  const [paidNow, setPaidNow] = useState(null) // { emailStatus } after paying from this page
  const unpaid = isUnpaid(order) && !order.cancelled
  const online = order.paymentMethod !== 'cod'
  const info = paidNow ?? (state?.placed ? state : null) // what to celebrate in the banner
  const canCancel = idx >= 0 && idx < 2
  const canDelete = idx === -1 || idx === ORDER_STEPS.length - 1

  return (
    <div className="container page narrow">
      {unpaid && (
        <div className="pay-banner" role="status">
          <div>
            <b>{order.paymentStatus === 'failed' ? '⚠️ Your last payment failed.' : '⏳ Payment pending.'}</b>
            <span> Your order is reserved for 15 minutes. Complete the payment to confirm it.</span>
          </div>
          <button className="btn btn--primary btn--sm" onClick={() => setPaying(true)}>Pay {formatPrice(order.totals.total)} now</button>
        </div>
      )}
      {info && !unpaid && !order.cancelled && (
        <div className="success">
          <div className="success__check">✓</div>
          <h2>{order.paymentStatus === 'paid' ? 'Payment received. Your order is confirmed!' : 'Thank you! Your order is confirmed.'}</h2>
          <p>We’ve received your order and will start packing it right away.</p>
          {info.emailStatus === 'queued' && <p>📧 A confirmation email is on its way to <b>{order.contactEmail}</b>.</p>}
          {info.emailStatus === 'saved-locally' && (
            <p>📬 <b>Learning mode:</b> no real mail server is configured, so your confirmation email was saved to a local dev inbox.{' '}
              <a className="link-btn" href={`/api/dev/inbox/${order.id}`} target="_blank" rel="noreferrer">Open the email →</a></p>
          )}
        </div>
      )}
      {order.cancelled && (order.paymentStatus === 'expired' || order.paymentStatus === 'void') && online && (
        <p className="alert" role="status">This order was not paid in time, so it was released and your items went back on sale.</p>
      )}
      <Link to="/orders" className="link-btn">← All orders</Link>
      <h1>Order #{order.id}</h1>
      <p className="muted">Placed on {formatDate(order.createdAt)} · {order.paymentMethod === 'cod' ? PAYMENT_LABELS.cod : `${PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus} (${order.paymentMethod.toUpperCase()})`}</p>

      <div className="panel"><OrderTracker index={idx} /></div>

      <div className="two-col">
        <div className="panel">
          <h3>Items</h3>
          <ul className="mini-lines">
            {order.items.map((i) => (
              <li key={i.id}><ProductArt product={i} size="xs" /><span>{i.title}<small>{i.brand} · Qty {i.qty}</small></span><b>{formatPrice(i.price * i.qty)}</b></li>
            ))}
          </ul>
          <h3>Delivery address</h3>
          <p>{order.address.name} · {order.address.phone}<br />{order.address.line1}, {order.address.city}, {order.address.state} – {order.address.pincode}</p>
          {canDelete && (
            <button className="btn btn--ghost danger" onClick={async () => {
              if (!window.confirm('Delete this order permanently?')) return
              try { await deleteOrder(order.id); toast('Order deleted'); navigate('/orders', { replace: true }) } catch (e) { toast(e.message, 'error') }
            }}>Delete order</button>
          )}
          {canCancel && <button className="btn btn--ghost danger" onClick={async () => { try { setOrder(await cancelOrder(order.id)); toast('Order cancelled') } catch (e) { toast(e.message, 'error') } }}>Cancel order</button>}
        </div>
        <aside className="summary-col"><OrderSummary totals={order.totals} /></aside>
      </div>
      {paying && (
        <GatewayModal
          order={order}
          onClose={() => setPaying(false)}
          onPaid={async (emailStatus) => {
            setPaying(false)
            setOrder(await getOrder(order.id)) // the server's view: paid, with a fresh shipping clock
            setPaidNow({ emailStatus })
            toast('Payment successful 🎉')
          }}
        />
      )}
    </div>
  )
}

export default function OrderDetail() {
  const { id } = useParams()
  const { data: order, loading, error } = useAsync(() => getOrder(id), [id])
  if (loading) return <div className="page-loader"><span className="spinner" /></div>
  if (error) return <div className="container"><EmptyState emoji="🫥" title="Order not found" text="We couldn’t find that order on your account." actionLabel="View orders" to="/orders" /></div>
  return <Detail key={order.id} initial={order} />
}
