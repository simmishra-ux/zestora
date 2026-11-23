from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product
from ..schemas import ProductOut

router = APIRouter(prefix="/products", tags=["products"])

SORTS = {
    "relevance": [desc(Product.reviews * Product.rating)],
    "price-asc": [Product.price],
    "price-desc": [desc(Product.price)],
    "rating": [desc(Product.rating), desc(Product.reviews)],
    "discount": [desc(Product.discount)],
    "newest": [desc(Product.added_order)],
}


@router.get("", response_model=list[ProductOut])
def list_products(
    db: Session = Depends(get_db),
    q: str = "",
    category: str = "",
    sub: str = "",  # sub-category, e.g. smartphones
    brand: Annotated[list[str] | None, Query()] = None,  # repeated query keys: ?brand=A&brand=B
    ids: Annotated[list[str] | None, Query()] = None,
    min_price: Annotated[int, Query(alias="minPrice", ge=0)] = 0,
    max_price: Annotated[int | None, Query(alias="maxPrice")] = None,
    min_rating: Annotated[float, Query(alias="minRating", ge=0, le=5)] = 0,
    min_discount: Annotated[int, Query(alias="minDiscount", ge=0, le=100)] = 0,
    in_stock: Annotated[bool, Query(alias="inStock")] = False,
    sort: Literal["relevance", "price-asc", "price-desc", "rating", "discount", "newest"] = "relevance",
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
):
    # Build the WHERE clause piece by piece; SQLAlchemy turns it into parameterised SQL (safe from SQL injection).
    conds = [Product.active.is_(True), Product.price >= min_price, Product.rating >= min_rating, Product.discount >= min_discount]
    for word in q.lower().split():
        like = f"%{word}%"  # every word must match somewhere in title/brand/category/sub-category
        conds.append(
            or_(
                Product.title.ilike(like),
                Product.brand.ilike(like),
                Product.category.ilike(like),
                Product.subcategory.ilike(like),
            )
        )
    if category:
        conds.append(Product.category == category)
    if sub:
        conds.append(Product.subcategory == sub)
    if brand:
        conds.append(Product.brand.in_(brand))
    if ids:
        conds.append(Product.id.in_(ids))
    if max_price is not None:
        conds.append(Product.price <= max_price)
    if in_stock:
        conds.append(Product.stock > 0)
    rows = db.scalars(select(Product).where(and_(*conds)).order_by(*SORTS[sort]).limit(limit)).all()
    if ids:  # keep the caller's order (wishlist/cart order matters)
        rows.sort(key=lambda p: ids.index(p.id))
    return rows


@router.get("/{product_id}", response_model=ProductOut)
def get_product(product_id: str, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product or not product.active:  # hidden products look exactly like missing ones to shoppers
        raise HTTPException(404, "Product not found")
    return product
