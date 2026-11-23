import { formatCount } from '@/utils/format'

export default function Rating({ value, count }) {
  if (count === 0) return <span className="rating"><span className="rating__pill rating__pill--new">New</span></span>
  const tone = value >= 4.0 ? 'good' : value >= 3.5 ? 'ok' : 'low'
  return (
    <span className="rating">
      <span className={`rating__pill rating__pill--${tone}`}>{value.toFixed(1)} ★</span>
      {count != null && <span className="rating__count">({formatCount(count)})</span>}
    </span>
  )
}
