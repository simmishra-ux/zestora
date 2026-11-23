import { useWishlist } from '@/context/WishlistContext'
import { HeartIcon } from './Icons'

export default function WishlistButton({ product, className = '' }) {
  const { has, toggle } = useWishlist()
  const active = has(product.id)
  return (
    <button
      className={`wish ${active ? 'wish--on' : ''} ${className}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(product) }}
      aria-pressed={active}
      aria-label={active ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      <HeartIcon width={20} height={20} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}
