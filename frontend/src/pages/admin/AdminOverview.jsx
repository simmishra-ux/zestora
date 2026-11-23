import { Link } from 'react-router-dom'
import { getStats } from '@/services/adminService'
import { useAsync } from '@/hooks/useAsync'
import { formatPrice } from '@/utils/format'

const STATUS_LABELS = { placed: 'Placed', packed: 'Packed', shipped: 'Shipped', out: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' }
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short' })

function Stat({ label, value, hint }) {
  return <div className="stat"><span>{label}</span><b>{value}</b>{hint && <small>{hint}</small>}</div>
}

export default function AdminOverview() {
  const { data: s, loading, error } = useAsync(getStats, [])
  if (error) return <p className="alert">{error.message}</p>
  if (loading || !s) return <div className="page-loader"><span className="spinner" /></div>
  const max = Math.max(...s.revenueByDay.map((d) => d.revenue), 1)

  return (
    <>
      <div className="stats-grid">
        <Stat label="Revenue" value={formatPrice(s.revenue)} hint="excl. cancelled orders" />
        <Stat label="Orders" value={s.orders} />
        <Stat label="Avg. order value" value={formatPrice(s.avgOrderValue)} />
        <Stat label="Open tickets" value={s.openTickets} hint="waiting for a reply" />
        <Stat label="Customers" value={s.customers} />
        <Stat label="Products" value={s.products} />
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h3>Revenue · last 7 days</h3>
          <div className="bars" role="img" aria-label="Revenue per day for the last 7 days">
            {s.revenueByDay.map((d) => (
              <div key={d.date} className="bars__col" title={`${d.date}: ${formatPrice(d.revenue)}`}>
                <span className="bars__val">{d.revenue ? formatPrice(d.revenue) : ''}</span>
                <span className="bars__bar" style={{ height: `${Math.max((d.revenue / max) * 100, d.revenue ? 4 : 1)}%` }} />
                <span className="bars__label">{day(d.date)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Orders by status</h3>
          {Object.keys(s.ordersByStatus).length === 0 && <p className="muted">No orders yet.</p>}
          <ul className="status-list">
            {Object.entries(s.ordersByStatus).map(([k, n]) => (
              <li key={k}><span className={`dot dot--${k}`} />{STATUS_LABELS[k]}<b>{n}</b></li>
            ))}
          </ul>
          <Link to="/admin/orders" className="link-btn">Manage orders →</Link>
        </section>

        <section className="panel">
          <h3>Best sellers</h3>
          {s.topProducts.length === 0 && <p className="muted">Sales will appear here.</p>}
          <ul className="mini-list">
            {s.topProducts.map((p) => <li key={p.id}><span>{p.emoji}</span><Link to={`/products/${p.id}`}>{p.title}</Link><b>{p.units} sold</b></li>)}
          </ul>
        </section>

        <section className="panel">
          <h3>Low stock <span className="muted">(≤ 5 left)</span></h3>
          {s.lowStock.length === 0 && <p className="muted">All products are well stocked 🎉</p>}
          <ul className="mini-list">
            {s.lowStock.map((p) => <li key={p.id}><span>{p.emoji}</span><Link to={`/products/${p.id}`}>{p.title}</Link><b className={p.stock === 0 ? 'danger' : 'warn'}>{p.stock === 0 ? 'Sold out' : `${p.stock} left`}</b></li>)}
          </ul>
          <Link to="/admin/products" className="link-btn">Manage inventory →</Link>
        </section>
      </div>
    </>
  )
}
