import { formatPrice } from '@/utils/format'

// Declared at module level (not inside OrderSummary) so React doesn't remount it on every render.
function Row({ label, value, cls = '' }) {
  return <div className={`row ${cls}`}><span>{label}</span><span>{value}</span></div>
}

export default function OrderSummary({ totals }) {
  return (
    <div className="summary">
      <h3>Price details</h3>
      <Row label={`Price (${totals.itemCount} items)`} value={formatPrice(totals.mrpTotal)} />
      {totals.productSavings > 0 && <Row label="Discount" value={`− ${formatPrice(totals.productSavings)}`} cls="green" />}
      {totals.couponDiscount > 0 && <Row label="Coupon" value={`− ${formatPrice(totals.couponDiscount)}`} cls="green" />}
      <Row label="Delivery" value={totals.delivery ? formatPrice(totals.delivery) : 'FREE'} cls={totals.delivery ? '' : 'green'} />
      <Row label="Total" value={formatPrice(totals.total)} cls="total" />
      {totals.productSavings + totals.couponDiscount > 0 && (
        <p className="summary__save">You’ll save {formatPrice(totals.productSavings + totals.couponDiscount)} on this order 🎉</p>
      )}
    </div>
  )
}
