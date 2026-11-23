import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/products', label: 'Products & inventory' },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/coupons', label: 'Coupons' },
  { to: '/admin/support', label: 'Support' },
]

export default function AdminLayout() {
  return (
    <div className="container page admin">
      <div className="admin__head">
        <div><span className="eyebrow">Admin</span><h1>Store dashboard</h1></div>
        <nav className="admin__tabs" aria-label="Admin sections">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>)}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
