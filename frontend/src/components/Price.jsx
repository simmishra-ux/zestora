import { formatPrice } from '@/utils/format'

export default function Price({ price, mrp, discount, large }) {
  return (
    <span className={`price ${large ? 'price--lg' : ''}`}>
      <strong>{formatPrice(price)}</strong>
      {discount > 0 && (
        <>
          <s>{formatPrice(mrp)}</s>
          <em>{discount}% off</em>
        </>
      )}
    </span>
  )
}
