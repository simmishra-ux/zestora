import { Link } from 'react-router-dom'
import { getCategories } from '@/services/productService'
import { Logo } from './Navbar'

const YEAR = new Date().getFullYear() // computed once at load, not on every render

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div>
          <Logo />
          <p className="footer__blurb">Shop what moves you. Curated products, honest prices and doorstep delivery you can track.</p>
        </div>
        <div>
          <h4>Shop</h4>
          {getCategories().slice(0, 5).map((c) => <Link key={c.slug} to={`/products?category=${c.slug}`}>{c.name}</Link>)}
        </div>
        <div>
          <h4>Account</h4>
          <Link to="/profile">Profile</Link>
          <Link to="/orders">Orders</Link>
          <Link to="/wishlist">Wishlist</Link>
          <Link to="/cart">Cart</Link>
        </div>
        <div>
          <h4>Offers</h4>
          <p className="footer__blurb">See all live offers in your cart and at payment. Try <b>ZEST10</b> or <b>UPI5</b>.</p>
        </div>
      </div>
      <div className="footer__bar">© {YEAR} Zestora · A learning project – no real orders or payments. Product data and photos: DummyJSON (demo data).</div>
    </footer>
  )
}
