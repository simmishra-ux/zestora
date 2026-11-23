import ProductCard from './ProductCard'

function CardSkeleton() {
  return (
    <div className="card card--skeleton" aria-hidden>
      <div className="skeleton" style={{ aspectRatio: '1' }} />
      <div className="skeleton skeleton--line" />
      <div className="skeleton skeleton--line" style={{ width: '60%' }} />
    </div>
  )
}

export default function ProductGrid({ products, loading, skeletons = 8 }) {
  return (
    <div className="grid">
      {loading
        ? Array.from({ length: skeletons }, (_, i) => <CardSkeleton key={i} />)
        : products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
    </div>
  )
}
