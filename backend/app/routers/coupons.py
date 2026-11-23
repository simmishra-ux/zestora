from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..coupons import discount_for, ineligible_reason, is_live, terms
from ..database import get_db
from ..models import Coupon, Product, User
from ..schemas import OffersIn, OffersOut
from ..security import get_optional_user

router = APIRouter(prefix="/coupons", tags=["coupons"])


@router.post("/offers", response_model=OffersOut)
def offers(body: OffersIn, user: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Every live offer, evaluated against THIS cart: what it would save, or why it can't apply yet.
    POST (not GET) because the cart travels in the body. The client sends ids + quantities, never prices."""
    qty = {}
    for line in body.items:
        qty[line.product_id] = qty.get(line.product_id, 0) + line.qty
    prices = {p.id: p.price for p in db.scalars(select(Product).where(Product.id.in_(qty)))}
    subtotal = sum(prices[i] * q for i, q in qty.items() if i in prices)

    result = []
    for c in db.scalars(select(Coupon).order_by(Coupon.created_at)):
        if not is_live(c):
            continue
        reason = ineligible_reason(c, subtotal, body.payment_method, user, db) if subtotal else "Add items to your cart"
        result.append(
            {
                "code": c.code,
                "title": c.title,
                "description": c.description,
                "eligible": reason is None,
                "reason": reason,
                "discount": discount_for(c, subtotal) if reason is None else 0,
                "terms": terms(c),
            }
        )
    result.sort(key=lambda o: (not o["eligible"], -o["discount"]))  # best savings first, unusable ones last
    if result and result[0]["eligible"] and result[0]["discount"] > 0:
        result[0]["best"] = True
    return {"subtotal": subtotal, "offers": result}
