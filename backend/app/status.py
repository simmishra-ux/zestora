"""Single source of truth for "what status is this order in?" (the frontend mirrors the step names/timings)."""

from datetime import UTC, datetime

from .models import Order

# (key, seconds after placing when the SIMULATED status reaches it)
STEPS = [("placed", 0), ("packed", 30), ("shipped", 90), ("out", 180), ("delivered", 300)]
KEYS = [k for k, _ in STEPS]
DELIVERED = KEYS.index("delivered")


def aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite drops tz info


def status_index(order: Order) -> int:
    """-1 = cancelled, otherwise 0..4. An admin's explicit status beats the age-based simulation."""
    if order.cancelled:
        return -1
    if order.payment_status in ("pending", "failed"):
        return 0  # an unpaid order is not packed or shipped
    if order.admin_status in KEYS:
        return KEYS.index(order.admin_status)
    started = order.paid_at or order.created_at  # the shipping clock starts when the money arrives (COD: at order time)
    elapsed = (datetime.now(UTC) - aware(started)).total_seconds()
    return max(i for i, (_, after) in enumerate(STEPS) if elapsed >= after)
