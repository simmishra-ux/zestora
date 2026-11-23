import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..coupons import discount_for, ineligible_reason, is_live
from ..database import get_db
from ..mailer import send_order_confirmation, smtp_configured
from ..models import Coupon, Order, OrderItem, Product, User
from ..order_ops import OutOfStock, cancel_row, expire_stale_orders, reserve_stock
from ..pricing import calc_totals
from ..schemas import BulkDeleteIn, BulkDeleteOut, OrderIn, OrderOut
from ..security import get_current_user
from ..status import DELIVERED, status_index

router = APIRouter(prefix="/orders", tags=["orders"])


def to_out(o: Order) -> dict:
    """Reshape the DB row (flat total columns) into the nested JSON the frontend expects."""
    return {
        "id": o.id,
        "created_at": o.created_at,
        "payment_method": o.payment_method,
        "coupon_code": o.coupon_code,
        "cancelled": o.cancelled,
        "payment_status": o.payment_status,
        "paid_at": o.paid_at,
        "contact_email": o.contact_email,
        "admin_status": o.admin_status,
        "address": o.address,
        "items": o.items,
        "totals": {
            k: getattr(o, k)
            for k in ("mrp_total", "subtotal", "product_savings", "coupon_discount", "delivery", "total", "item_count")
        },
    }


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderIn,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expire_stale_orders(db)  # release stock held by abandoned, unpaid orders before checking availability
    code = (body.coupon_code or "").strip().upper() or None
    coupon = db.get(Coupon, code) if code else None
    if code and (coupon is None or not is_live(coupon)):
        raise HTTPException(422, "This coupon is invalid or has expired.")

    # Merge duplicate lines, then load every product in one query.
    qty_by_id: dict[str, int] = {}
    for line in body.items:
        qty_by_id[line.product_id] = qty_by_id.get(line.product_id, 0) + line.qty
    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(qty_by_id)))}

    for pid, qty in qty_by_id.items():
        p = products.get(pid)
        if not p:
            raise HTTPException(422, f"Unknown product {pid}.")
        if not p.active:
            raise HTTPException(409, f"“{p.title}” is no longer available.")
        if p.stock < qty:
            raise HTTPException(409, f"Only {p.stock} left of “{p.title}”.")

    lines = [(products[i].price, products[i].mrp, q) for i, q in qty_by_id.items()]
    discount = 0
    if coupon:
        subtotal = sum(price * q for price, _, q in lines)
        reason = ineligible_reason(coupon, subtotal, body.payment_method, user, db)
        if reason:  # the browser may be out of date or malicious: enforce EVERY rule again here
            raise HTTPException(422, f"Coupon {coupon.code} can’t be applied: {reason}.")
        discount = discount_for(coupon, subtotal)
    totals = calc_totals(lines, discount)
    online = body.payment_method != "cod"
    order = Order(
        id=f"ZS{secrets.randbelow(10**8):08d}",
        user_id=user.id,
        payment_method=body.payment_method,
        # Online orders wait for the gateway's signed webhook; cash-on-delivery has nothing to wait for.
        payment_status="pending" if online else "cod",
        contact_email=body.email or user.email,
        coupon_code=coupon.code if coupon else None,
        address=body.address.model_dump(by_alias=True),
        **totals,
        items=[
            OrderItem(
                product_id=i,
                title=products[i].title,
                brand=products[i].brand,
                emoji=products[i].emoji,
                hue=products[i].hue,
                image=products[i].image,
                price=products[i].price,
                qty=q,
            )
            for i, q in qty_by_id.items()
        ],
    )
    db.add(order)
    try:
        reserve_stock(db, qty_by_id)  # atomic; the authoritative stock check (the loop above is only for a friendly message)
    except OutOfStock as e:
        db.rollback()
        raise HTTPException(409, f"Sorry, “{products[e.product_id].title}” just sold out.") from e
    db.commit()

    if online:
        return {**to_out(order), "email_status": None}  # the confirmation email is sent once the payment succeeds
    # Cash on delivery: confirm now. After the commit (never announce an unsaved order), in the background.
    snapshot = OrderOut.model_validate(to_out(order)).model_dump(by_alias=True, mode="json")
    background.add_task(send_order_confirmation, snapshot, order.contact_email, user.name)
    return {**to_out(order), "email_status": "queued" if smtp_configured() else "saved-locally"}


@router.get("", response_model=list[OrderOut])
def list_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    expire_stale_orders(db)
    rows = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())).all()
    return [to_out(o) for o in rows]


def _own_order(order_id: str, user: User, db: Session) -> Order:
    order = db.get(Order, order_id)
    # 404 (not 403) for other people's orders: don't even reveal that the id exists.
    if not order or order.user_id != user.id:
        raise HTTPException(404, "Order not found")
    return order


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    expire_stale_orders(db)
    return to_out(_own_order(order_id, user, db))


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(order_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = _own_order(order_id, user, db)
    if order.cancelled:
        raise HTTPException(409, "Order is already cancelled.")
    if status_index(order) > 1:  # only "placed" and "packed" orders can still be cancelled
        raise HTTPException(409, "This order has already shipped and can’t be cancelled.")
    cancel_row(db, order)
    db.commit()
    return to_out(order)


NOT_DELETABLE = "Only delivered or cancelled orders can be deleted. Cancel it first if it hasn't shipped."


def _delete_blocker(order: Order) -> str | None:
    """The ONE place that decides if an order may be deleted (single and bulk delete both use it)."""
    return None if status_index(order) in (-1, DELIVERED) else NOT_DELETABLE


@router.post("/bulk-delete", response_model=BulkDeleteOut)
def bulk_delete(body: BulkDeleteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete many orders at once. Partial success: eligible ones are deleted, the rest are reported back."""
    ids = list(dict.fromkeys(body.ids))  # de-duplicate, keep order
    # Filtering by user_id here means other people's ids simply come back "not found" -- never leaked.
    mine = {o.id: o for o in db.scalars(select(Order).where(Order.user_id == user.id, Order.id.in_(ids)))}
    deleted, skipped = [], []
    for oid in ids:
        order = mine.get(oid)
        if order is None:
            skipped.append({"id": oid, "reason": "Order not found."})
        elif reason := _delete_blocker(order):
            skipped.append({"id": oid, "reason": reason})
        else:
            db.delete(order)
            deleted.append(oid)
    db.commit()  # one transaction for the whole batch
    return {"deleted": deleted, "skipped": skipped}


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(order_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove one order from the user's history (finished orders only).
    Real shops usually *hide* orders ("soft delete") to keep records for accounting and refunds."""
    order = _own_order(order_id, user, db)
    if reason := _delete_blocker(order):
        raise HTTPException(409, reason)
    db.delete(order)  # cascade="all, delete-orphan" on Order.items removes its OrderItem rows too
    db.commit()
