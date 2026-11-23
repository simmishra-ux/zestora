// Display-side money math. The coupon DISCOUNT comes from the server (coupons have rules: caps, minimums,
// payment methods...), and the server recomputes everything again when the order is placed.
export const FREE_DELIVERY_THRESHOLD = 499
const DELIVERY_FEE = 49

export function calcTotals(lines, couponDiscount = 0) {
  const mrpTotal = lines.reduce((s, l) => s + l.product.mrp * l.qty, 0)
  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0)
  const afterCoupon = subtotal - couponDiscount
  const delivery = lines.length === 0 || afterCoupon >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE
  return {
    mrpTotal,
    subtotal,
    productSavings: mrpTotal - subtotal,
    couponDiscount,
    delivery,
    total: afterCoupon + delivery,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
  }
}
