import { useState } from 'react'

// A product "photo". Products have real photos; ones without (or whose file fails to load) fall back to a gradient tile.
// `variant` picks a gallery photo (product page). Without it we use the small thumbnail (cards, lists, search).
export default function ProductArt({ product, size = 'md', variant }) {
  const gallery = product.images ?? []
  const src = variant != null && gallery.length ? gallery[variant % gallery.length] : product.image
  const [failedSrc, setFailedSrc] = useState(null)

  if (src && failedSrc !== src) {
    return (
      <div className={`art art--${size} art--photo`}>
        <img className="art__img" src={src} alt={product.title} loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      </div>
    )
  }
  const h = ((product.hue ?? 260) + (variant ?? 0) * 24) % 360
  return (
    <div className={`art art--${size}`} style={{ '--h': h }} role="img" aria-label={product.title}>
      <span className="art__blob" />
      <span className="art__emoji">{product.emoji}</span>
    </div>
  )
}
