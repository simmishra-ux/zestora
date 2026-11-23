"""Product reviews. Only customers who bought the product can review it (verified buyers), one review each.
The product's star rating is updated INCREMENTALLY with the exact maths below, so the seeded catalog ratings
and real reviews blend naturally without needing a separate baseline."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Order, OrderItem, Product, Review, User
from ..schemas import ReviewIn, ReviewsOut
from ..security import get_current_user, get_optional_user

router = APIRouter(prefix="/products", tags=["reviews"])


def _author(user: User) -> str:
    parts = user.name.split()
    return f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else parts[0]


def _out(r: Review) -> dict:
    return {
        "id": r.id,
        "rating": r.rating,
        "title": r.title,
        "body": r.body,
        "created_at": r.created_at,
        "author": _author(r.user),
    }


def _bought(db: Session, user: User, product_id: str) -> bool:
    q = (
        select(OrderItem.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.user_id == user.id,
            Order.cancelled.is_(False),
            Order.payment_status.in_(("paid", "cod")),
            OrderItem.product_id == product_id,
        )
        .limit(1)
    )
    return db.scalar(q) is not None


def _product(db: Session, product_id: str) -> Product:
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Product not found")
    return p


def _payload(db: Session, product_id: str, user: User | None) -> dict:
    rows = db.scalars(select(Review).where(Review.product_id == product_id).order_by(Review.created_at.desc())).all()
    mine = next((r for r in rows if user and r.user_id == user.id), None)
    return {
        "reviews": [_out(r) for r in rows],
        "mine": _out(mine) if mine else None,
        "can_review": bool(user and _bought(db, user, product_id)),
    }


@router.get("/{product_id}/reviews", response_model=ReviewsOut)
def list_reviews(product_id: str, user: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    _product(db, product_id)
    return _payload(db, product_id, user)


@router.put("/{product_id}/reviews/me", response_model=ReviewsOut)
def upsert_review(product_id: str, body: ReviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    product = _product(db, product_id)
    if not _bought(db, user, product_id):
        raise HTTPException(403, "Only customers who bought this product can review it.")
    existing = db.scalar(select(Review).where(Review.product_id == product_id, Review.user_id == user.id))
    n = product.reviews
    if existing:  # edit: shift the average by the difference
        product.rating += (body.rating - existing.rating) / n
        existing.rating, existing.title, existing.body = body.rating, body.title.strip(), body.body.strip()
    else:  # create: weighted average of the old average and the new rating
        product.rating = (product.rating * n + body.rating) / (n + 1)
        product.reviews = n + 1
        db.add(
            Review(product_id=product_id, user_id=user.id, rating=body.rating, title=body.title.strip(), body=body.body.strip())
        )
    db.commit()
    return _payload(db, product_id, user)


@router.delete("/{product_id}/reviews/me", response_model=ReviewsOut)
def delete_review(product_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    product = _product(db, product_id)
    existing = db.scalar(select(Review).where(Review.product_id == product_id, Review.user_id == user.id))
    if not existing:
        raise HTTPException(404, "You haven't reviewed this product.")
    n = product.reviews
    product.rating = (product.rating * n - existing.rating) / (n - 1) if n > 1 else 0.0  # undo the create maths
    product.reviews = max(n - 1, 0)
    db.delete(existing)
    db.commit()
    return _payload(db, product_id, user)
