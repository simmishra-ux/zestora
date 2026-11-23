"""Order lifecycle helpers shared by the customer, admin and payment routers."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import Order, Product

PAYMENT_WINDOW = timedelta(minutes=15)  # an unpaid online order holds stock for this long, then is released
UNPAID = ("pending", "failed")


class OutOfStock(Exception):
    def __init__(self, product_id: str):
        self.product_id = product_id


def reserve_stock(db: Session, qty_by_id: dict[str, int]) -> None:
    """Take stock ATOMICALLY: the check and the decrement happen in ONE SQL statement.

    The old way (read stock into Python, check, subtract, save) has a race: two shoppers can both read
    "1 left", both pass the check, and both succeed, so you sell 2 of 1. Here the database itself refuses
    the second UPDATE (rowcount 0), because the WHERE clause is evaluated at the moment of writing."""
    for pid, qty in qty_by_id.items():
        result = db.execute(update(Product).where(Product.id == pid, Product.stock >= qty).values(stock=Product.stock - qty))
        if result.rowcount != 1:
            raise OutOfStock(pid)  # the caller rolls back, which also undoes the earlier decrements of this order


def cancel_row(db: Session, order: Order) -> None:
    """Cancel + put stock back (atomically) + settle the payment. Used by customer cancel, admin cancel and expiry."""
    order.cancelled = True
    for item in order.items:
        db.execute(update(Product).where(Product.id == item.product_id).values(stock=Product.stock + item.qty))
    order.payment_status = {"paid": "refunded", "pending": "void", "failed": "void"}.get(
        order.payment_status, order.payment_status
    )


def expire_stale_orders(db: Session) -> int:
    """Cancel online orders that were never paid within PAYMENT_WINDOW and release their stock.
    Done lazily here to keep the project simple; real systems run this as a scheduled background job."""
    cutoff = datetime.now(UTC) - PAYMENT_WINDOW
    stale = db.scalars(
        select(Order).where(Order.payment_status.in_(UNPAID), Order.cancelled.is_(False), Order.created_at < cutoff)
    ).all()
    for o in stale:
        cancel_row(db, o)
        o.payment_status = "expired"
    if stale:
        db.commit()
    return len(stale)
