import { useEffect } from 'react'
import { useWishlist } from '@/context/WishlistContext'
import { getProductsByIds } from '@/services/productService'
import { useAsync } from '@/hooks/useAsync'
import ProductGrid from '@/components/ProductGrid'
import EmptyState from '@/components/EmptyState'

export default function Wishlist() {
  const { ids, prune } = useWishlist()
  const { data, loading } = useAsync(() => getProductsByIds(ids), [ids.join(',')])

  // The server only returns products that still exist and are visible. Forget the rest.
  useEffect(() => {
    if (data && data.length !== ids.length) prune(data.map((p) => p.id))
  }, [data, ids, prune])

  const count = data ? data.length : ids.length
  if (!loading && count === 0)
    return <div className="container"><EmptyState emoji="💝" title="Your wishlist is empty" text="Tap the heart on any product to save it for later." /></div>
  return (
    <div className="container page">
      <h1>My wishlist <span className="muted">({count})</span></h1>
      <ProductGrid products={data ?? []} loading={loading && !data} skeletons={Math.min(ids.length, 8)} />
    </div>
  )
}
