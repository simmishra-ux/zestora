import { NavLink } from 'react-router-dom'
import { useCart } from '@/context/CartContext'
import { BoxIcon, CartIcon, GridIcon, HomeIcon, UserIcon } from './Icons'

// Thumb-friendly bottom navigation, visible only on small screens (see CSS).
export default function MobileTabBar() {
  const { count } = useCart()
  const tab = ({ isActive }) => `tab ${isActive ? 'tab--active' : ''}`
  return (
    <nav className="tabbar" aria-label="Primary">
      <NavLink to="/" end className={tab}><HomeIcon />Home</NavLink>
      <NavLink to="/products" className={tab}><GridIcon />Shop</NavLink>
      <NavLink to="/cart" className={tab}><CartIcon />Cart{count > 0 && <span className="badge">{count}</span>}</NavLink>
      <NavLink to="/orders" className={tab}><BoxIcon />Orders</NavLink>
      <NavLink to="/profile" className={tab}><UserIcon />Me</NavLink>
    </nav>
  )
}
