import { memo } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '@/context/CartContext'
import ProductArt from './ProductArt'
import Rating from './Rating'
import Price from './Price'
import WishlistButton from './WishlistButton'

// memo: a card re-renders only if its `product` prop changes, which keeps big grids smooth.
export default memo(function ProductCard({ product, index = 0 }) {
  const { add } = useCart()
  const out = product.stock === 0
  return (
    <article className="card" style={{ '--i': index % 12 }}>
      <Link to={`/products/${product.id}`} className="card__link">
        <div className="card__media">
          <ProductArt product={product} />
          {product.discount >= 25 && !out && <span className="tag tag--hot">Hot deal</span>}
          {out && <span className="tag tag--out">Sold out</span>}
          {!out && product.stock <= 5 && <span className="tag tag--low">Only {product.stock} left</span>}
          <WishlistButton product={product} className="card__wish" />
        </div>
        <div className="card__body">
          <span className="card__brand">{product.brand}</span>
          <h3 className="card__title">{product.title}</h3>
          <Rating value={product.rating} count={product.reviews} />
          <Price price={product.price} mrp={product.mrp} discount={product.discount} />
        </div>
      </Link>
      <button className="btn btn--soft btn--block card__add" disabled={out} onClick={() => add(product)}>
        {out ? 'Notify me' : 'Add to cart'}
      </button>
    </article>
  )
})
