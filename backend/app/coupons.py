"""All coupon rules in ONE place. The offers list, the cart and order creation all call these same functions,
so what the customer is shown can never disagree with what the server charges."""

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Coupon, Order, User
from .status import aware

PAY_NAMES = {"upi": "UPI", "card": "card", "cod": "Cash on delivery"}


def is_live(c: Coupon) -> bool:
    return c.active and (c.expires_at is None or aware(c.expires_at) > datetime.now(UTC))


def discount_for(c: Coupon, subtotal: int) -> int:
    amount = round(subtotal * c.value / 100) if c.kind == "percent" else c.value
    if c.max_discount:
        amount = min(amount, c.max_discount)
    return max(0, min(amount, subtotal))  # never discount more than the cart is worth


def used_count(db: Session, user: User, code: str) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(Order.user_id == user.id, Order.coupon_code == code, Order.cancelled.is_(False))
        )
        or 0
    )


def ineligible_reason(c: Coupon, subtotal: int, payment_method: str | None, user: User | None, db: Session) -> str | None:
    """None = usable. Otherwise a customer-friendly reason. `payment_method=None` means "not chosen yet"."""
    if subtotal < c.min_order:
        return f"Add ₹{c.min_order - subtotal:,} more to use this offer"
    if c.payment_methods and payment_method and payment_method not in c.payment_methods:
        return "Valid only on " + " / ".join(PAY_NAMES[m] for m in c.payment_methods) + " payments"
    if user is not None:  # guests can browse offers; user-specific rules are enforced when they log in / order
        if c.first_order_only:
            has_orders = db.scalar(
                select(func.count()).select_from(Order).where(Order.user_id == user.id, Order.cancelled.is_(False))
            )
            if has_orders:
                return "Valid on your first order only"
        if c.per_user_limit is not None and used_count(db, user, c.code) >= c.per_user_limit:
            return "You’ve already used this offer"
    return None


def terms(c: Coupon) -> list[str]:
    t = []
    if c.min_order:
        t.append(f"Min. order ₹{c.min_order:,}")
    if c.kind == "percent" and c.max_discount:
        t.append(f"Up to ₹{c.max_discount:,} off")
    if c.payment_methods:
        t.append(" / ".join(PAY_NAMES[m] for m in c.payment_methods) + " only")
    if c.first_order_only:
        t.append("First order only")
    if c.per_user_limit:
        t.append(f"{c.per_user_limit} use per customer")
    if c.expires_at:
        t.append("Expires " + aware(c.expires_at).strftime("%d %b %Y"))
    return t
