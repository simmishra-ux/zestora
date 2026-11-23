"""Server-side money math. The client's totals are NEVER trusted; the server recomputes everything."""

FREE_DELIVERY_THRESHOLD = 499
DELIVERY_FEE = 49


def calc_totals(lines: list[tuple[int, int, int]], coupon_discount: int = 0) -> dict:
    """lines = [(price, mrp, qty), ...]. The coupon discount is decided by coupons.py; this only does the arithmetic."""
    mrp_total = sum(mrp * qty for _, mrp, qty in lines)
    subtotal = sum(price * qty for price, _, qty in lines)
    after = subtotal - coupon_discount
    delivery = 0 if not lines or after >= FREE_DELIVERY_THRESHOLD else DELIVERY_FEE
    return {
        "mrp_total": mrp_total,
        "subtotal": subtotal,
        "product_savings": mrp_total - subtotal,
        "coupon_discount": coupon_discount,
        "delivery": delivery,
        "total": after + delivery,
        "item_count": sum(qty for _, _, qty in lines),
    }
