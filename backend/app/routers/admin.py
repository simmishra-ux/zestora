"""Admin API. EVERY route requires an admin (router-level dependency), so a new route can't forget the check."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Coupon, Order, OrderEvent, OrderItem, Product, Review, SupportThread, User, now
from ..order_ops import UNPAID, cancel_row
from ..schemas import (
    AdminOrderOut,
    AgentReplyIn,
    CouponAdminIn,
    CouponAdminOut,
    ProductAdminIn,
    ProductOut,
    StatusIn,
    SupportThreadAdminOut,
    SupportThreadSummary,
    ThreadActionIn,
)
from ..security import require_admin
from ..status import KEYS, aware, status_index
from .orders import to_out

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
LOW_STOCK = 5


def _discount(price: int, mrp: int) -> int:
    return max(0, round((1 - price / mrp) * 100))


# ---------------- overview ----------------
@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    orders = db.scalars(select(Order)).all()
    live = [o for o in orders if not o.cancelled and o.payment_status in ("paid", "cod")]  # unpaid orders aren't revenue
    today = datetime.now(UTC).date()
    by_day = defaultdict(int)
    for o in live:
        by_day[aware(o.created_at).date()] += o.total
    series = [
        {"date": (today - timedelta(days=i)).isoformat(), "revenue": by_day[today - timedelta(days=i)]} for i in range(6, -1, -1)
    ]

    by_status = defaultdict(int)
    for o in orders:
        idx = status_index(o)
        by_status["cancelled" if idx == -1 else KEYS[idx]] += 1

    top = db.execute(
        select(OrderItem.product_id, OrderItem.title, OrderItem.emoji, func.sum(OrderItem.qty).label("units"))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.cancelled.is_(False), Order.payment_status.in_(("paid", "cod")))
        .group_by(OrderItem.product_id, OrderItem.title, OrderItem.emoji)
        .order_by(func.sum(OrderItem.qty).desc())
        .limit(5)
    ).all()
    low = db.scalars(select(Product).where(Product.stock <= LOW_STOCK).order_by(Product.stock).limit(8)).all()
    return {
        "revenue": sum(o.total for o in live),
        "orders": len(orders),
        "customers": db.scalar(select(func.count()).select_from(User)),
        "products": db.scalar(select(func.count()).select_from(Product)),
        "openTickets": db.scalar(select(func.count()).select_from(SupportThread).where(SupportThread.status == "waiting_agent")),
        "avgOrderValue": round(sum(o.total for o in live) / len(live)) if live else 0,
        "revenueByDay": series,
        "ordersByStatus": dict(by_status),
        "topProducts": [{"id": r.product_id, "title": r.title, "emoji": r.emoji, "units": int(r.units)} for r in top],
        "lowStock": [{"id": p.id, "title": p.title, "emoji": p.emoji, "stock": p.stock} for p in low],
    }


# ---------------- products / inventory ----------------
@router.get("/products", response_model=list[ProductOut])
def admin_products(
    q: str = "",
    low_stock: bool = Query(False, alias="lowStock"),
    visibility: Literal["all", "visible", "hidden"] = "all",
    db: Session = Depends(get_db),
):
    stmt = select(Product).order_by(Product.added_order.desc())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Product.title.ilike(like), Product.brand.ilike(like), Product.id.ilike(like)))
    if low_stock:
        stmt = stmt.where(Product.stock <= LOW_STOCK)
    if visibility != "all":  # admins see hidden products too; this just lets them filter
        stmt = stmt.where(Product.active.is_(visibility == "visible"))
    return db.scalars(stmt).all()


def _apply(p: Product, body: ProductAdminIn) -> None:
    if body.price > body.mrp:
        raise HTTPException(422, "Selling price can't be higher than MRP.")
    for f in ("title", "brand", "category", "price", "mrp", "stock", "emoji", "hue", "description", "active"):
        setattr(p, f, getattr(body, f))
    p.discount = _discount(body.price, body.mrp)


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductAdminIn, db: Session = Depends(get_db)):
    nxt = (db.scalar(select(func.max(Product.added_order))) or 0) + 1
    p = Product(
        id=f"p{nxt:03d}",
        added_order=nxt,
        rating=0.0,
        reviews=0,
        colors=[{"name": "Midnight", "hex": "#1c1b33"}, {"name": "Ivory", "hex": "#f1ead8"}],
        highlights=["Premium build quality", "Free delivery on orders above ₹499", "7-day easy replacement"],
    )
    _apply(p, body)
    db.add(p)
    db.commit()
    return p


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: str, body: ProductAdminIn, db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Product not found")
    _apply(p, body)
    db.commit()
    return p


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: str, db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Product not found")
    # Past orders keep their own copy of title/price (see OrderItem), so they stay readable after this.
    for r in db.scalars(select(Review).where(Review.product_id == product_id)):
        db.delete(r)
    db.delete(p)
    db.commit()


# ---------------- orders ----------------
@router.get("/orders", response_model=list[AdminOrderOut])
def admin_orders(
    status: Literal["all", "placed", "packed", "shipped", "out", "delivered", "cancelled"] = "all", db: Session = Depends(get_db)
):
    rows = db.scalars(select(Order).order_by(Order.created_at.desc())).all()
    out = []
    for o in rows:
        idx = status_index(o)
        if status != "all" and ("cancelled" if idx == -1 else KEYS[idx]) != status:
            continue
        out.append({**to_out(o), "customer_name": o.user.name, "customer_email": o.user.email})
    return out


@router.post("/orders/{order_id}/status", response_model=AdminOrderOut)
def set_status(order_id: str, body: StatusIn, db: Session = Depends(get_db)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Order not found")
    if body.status == "cancelled":
        if o.cancelled:
            raise HTTPException(409, "Order is already cancelled.")
        cancel_row(db, o)  # restores stock, same as a customer cancel
    else:
        if o.cancelled:
            raise HTTPException(409, "A cancelled order can't be moved to another status.")
        if o.payment_status in UNPAID:
            raise HTTPException(409, "Payment hasn't been received for this order yet.")
        o.events.append(OrderEvent(status=body.status))
    db.commit()
    return {**to_out(o), "customer_name": o.user.name, "customer_email": o.user.email}


# ---------------- coupons ----------------
def _coupon_out(c: Coupon, db: Session) -> dict:
    used = db.scalar(select(func.count()).select_from(Order).where(Order.coupon_code == c.code, Order.cancelled.is_(False))) or 0
    return {**{f: getattr(c, f) for f in CouponAdminIn.model_fields}, "used": used}


def _check_coupon(body: CouponAdminIn) -> None:
    if body.kind == "percent" and body.value > 100:
        raise HTTPException(422, "A percentage discount can't exceed 100%.")


@router.get("/coupons", response_model=list[CouponAdminOut])
def admin_coupons(db: Session = Depends(get_db)):
    return [_coupon_out(c, db) for c in db.scalars(select(Coupon).order_by(Coupon.created_at.desc()))]


@router.post("/coupons", response_model=CouponAdminOut, status_code=201)
def create_coupon(body: CouponAdminIn, db: Session = Depends(get_db)):
    _check_coupon(body)
    code = body.code.upper()
    if db.get(Coupon, code):
        raise HTTPException(409, f"Coupon {code} already exists.")
    c = Coupon(**{**body.model_dump(), "code": code})
    db.add(c)
    db.commit()
    return _coupon_out(c, db)


@router.put("/coupons/{code}", response_model=CouponAdminOut)
def update_coupon(code: str, body: CouponAdminIn, db: Session = Depends(get_db)):
    _check_coupon(body)
    c = db.get(Coupon, code.upper())
    if not c:
        raise HTTPException(404, "Coupon not found")
    for f, v in body.model_dump(exclude={"code"}).items():  # the code itself is the identifier; it can't change
        setattr(c, f, v)
    db.commit()
    return _coupon_out(c, db)


@router.delete("/coupons/{code}", status_code=204)
def delete_coupon(code: str, db: Session = Depends(get_db)):
    c = db.get(Coupon, code.upper())
    if not c:
        raise HTTPException(404, "Coupon not found")
    db.delete(c)  # past orders keep the code string they used, so history is unaffected
    db.commit()


# ---------------- support inbox ----------------
def _thread_or_404(thread_id: str, db: Session) -> SupportThread:
    thread = db.get(SupportThread, thread_id)
    if not thread:
        raise HTTPException(404, "Ticket not found")
    return thread


def _with_customer(t: SupportThread) -> dict:
    return {
        "id": t.id, "status": t.status, "category": t.category, "order_id": t.order_id, "created_at": t.created_at,
        "updated_at": t.updated_at, "messages": t.messages, "customer_name": t.user.name, "customer_email": t.user.email,
    }  # fmt: skip


@router.get("/support/threads", response_model=list[SupportThreadSummary])
def support_threads(status: Literal["all", "needs_reply", "answered", "resolved", "bot"] = "all", db: Session = Depends(get_db)):
    wanted = {"needs_reply": "waiting_agent", "answered": "answered", "resolved": "resolved", "bot": "bot"}.get(status)
    stmt = select(SupportThread).order_by(SupportThread.updated_at.desc())
    if wanted:
        stmt = stmt.where(SupportThread.status == wanted)
    rows = list(db.scalars(stmt))
    rows.sort(
        key=lambda t: t.status != "waiting_agent"
    )  # stable: tickets that need a reply come first, newest first within each group
    return [
        {
            "id": t.id, "status": t.status, "category": t.category, "order_id": t.order_id, "customer_name": t.user.name,
            "customer_email": t.user.email, "last_message": t.messages[-1].text[:120] if t.messages else "",
            "last_sender": t.messages[-1].sender if t.messages else "", "message_count": len(t.messages),
            "created_at": t.created_at, "updated_at": t.updated_at,
        }
        for t in rows
    ]  # fmt: skip


@router.get("/support/threads/{thread_id}", response_model=SupportThreadAdminOut)
def support_thread(thread_id: str, db: Session = Depends(get_db)):
    return _with_customer(_thread_or_404(thread_id, db))


@router.post("/support/threads/{thread_id}/reply", response_model=SupportThreadAdminOut)
def support_reply(thread_id: str, body: AgentReplyIn, db: Session = Depends(get_db)):
    from .support import add_message  # local import: support.py is the customer router

    thread = _thread_or_404(thread_id, db)
    add_message(thread, "agent", body.text)
    thread.status, thread.updated_at = "answered", now()
    db.commit()
    return _with_customer(thread)


@router.post("/support/threads/{thread_id}/action", response_model=SupportThreadAdminOut)
def support_action(thread_id: str, body: ThreadActionIn, db: Session = Depends(get_db)):
    thread = _thread_or_404(thread_id, db)
    thread.status = "resolved" if body.action == "resolve" else "waiting_agent"
    thread.updated_at = now()
    db.commit()
    return _with_customer(thread)
