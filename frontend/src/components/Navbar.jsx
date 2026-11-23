import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useCart } from '@/context/CartContext'
import { useWishlist } from '@/context/WishlistContext'
import { getCategories } from '@/services/productService'
import SearchBox from './SearchBox'
import { CartIcon, HeartIcon, UserIcon } from './Icons'

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Zestora home">
      <span className="logo__mark">Z</span>
      <span className="logo__text">zestora</span>
    </Link>
  )
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const { count } = useCart()
  const wishlist = useWishlist()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the account dropdown when clicking anywhere else.
  useEffect(() => {
    const onDown = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <header className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}>
      <div className="container navbar__row">
        <Logo />
        <SearchBox />
        <nav className="navbar__actions" aria-label="Account and cart">
          <NavLink to="/wishlist" className="icon-btn" aria-label="Wishlist">
            <HeartIcon />
            {wishlist.ids.length > 0 && <span className="badge">{wishlist.ids.length}</span>}
          </NavLink>
          <NavLink to="/cart" className="icon-btn" aria-label="Cart">
            <CartIcon />
            {count > 0 && <span className="badge" key={count}>{count}</span>}
          </NavLink>
          {user ? (
            <div className="account" ref={menuRef}>
              <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
                {user.name.charAt(0).toUpperCase()}
              </button>
              {menuOpen && (
                <div className="dropdown" role="menu" onClick={() => setMenuOpen(false)}>
                  <div className="dropdown__head">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                  {user.isAdmin && <Link to="/admin" role="menuitem">⚙️ Admin dashboard</Link>}
                  <Link to="/profile" role="menuitem">My profile</Link>
                  <Link to="/orders" role="menuitem">My orders</Link>
                  <Link to="/wishlist" role="menuitem">Wishlist</Link>
                  <button role="menuitem" onClick={() => { logout(); navigate('/') }}>Log out</button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="btn btn--primary btn--sm navbar__login"><UserIcon width={18} height={18} /> Login</Link>
          )}
        </nav>
      </div>
      <div className="catbar">
        <div className="container catbar__row">
          <NavLink to="/products" end>All</NavLink>
          {getCategories().map((c) => (
            <NavLink key={c.slug} to={`/products?category=${c.slug}`}>{c.name}</NavLink>
          ))}
        </div>
      </div>
    </header>
  )
}
