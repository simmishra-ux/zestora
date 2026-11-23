"""Fills the products table from seed/products.json the first time the app starts."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .models import Address, Coupon, Meta, Product, User

SEED_FILE = Path(__file__).resolve().parent.parent / "seed" / "products.json"


CATALOG_VERSION = "photos-v1"  # bump this when seed/products.json changes and should be loaded into existing databases


def seed_products(db: Session, path: Path = SEED_FILE, version: str = CATALOG_VERSION) -> int:
    """Load the catalog ONCE per catalog version. Returns how many products were added.

    * Runs only if this version hasn't been loaded yet (recorded in the `meta` table), so a product an admin deletes
      does not come back on the next restart, and live stock levels are never overwritten.
    * Products from an older catalog that have no photo (the original emoji demo items) are HIDDEN, not deleted:
      past orders keep pointing at them, and an admin can bring any of them back.
    * New products are inserted only if their id is missing, so it is safe on a database that already has data."""
    if db.get(Meta, "catalog_version") and db.get(Meta, "catalog_version").value == version:
        return 0
    db.execute(update(Product).where(Product.image.is_(None), Product.added_order <= 48).values(active=False))
    existing = set(db.scalars(select(Product.id)))
    added = 0
    for r in json.loads(path.read_text()):
        if r["id"] in existing:
            continue
        r["added_order"] = r.pop("addedOrder")  # JSON is camelCase, columns are snake_case
        db.add(Product(**r))
        added += 1
    row = db.get(Meta, "catalog_version")
    if row:
        row.value = version
    else:
        db.add(Meta(key="catalog_version", value=version))
    db.commit()
    return added


def migrate_legacy_addresses(db: Session) -> int:
    """One-time upgrade: copy addresses from the old JSON column into the address_book table."""
    moved = 0
    for user in db.scalars(select(User)):
        if user.addresses or not user.legacy_addresses:
            continue  # already migrated, or nothing to migrate
        for n, a in enumerate(user.legacy_addresses):
            try:
                user.addresses.append(
                    Address(
                        label="Home",
                        name=a["name"],
                        phone=a["phone"],
                        line1=a["line1"],
                        city=a["city"],
                        state=a["state"],
                        pincode=a["pincode"],
                        is_default=(n == 0),
                    )
                )
                moved += 1
            except KeyError:
                continue  # skip malformed legacy rows rather than crash the server at startup
        user.legacy_addresses = []
    db.commit()
    return moved


def seed_coupons(db: Session) -> int:
    if db.scalar(select(func.count()).select_from(Coupon)):
        return 0  # admins manage coupons from now on; never overwrite their changes
    soon = datetime.now(UTC) + timedelta(days=60)
    db.add_all(
        [
            Coupon(
                code="ZEST10", title="10% off on everything", description="Evergreen offer on any order", kind="percent", value=10
            ),
            Coupon(
                code="WELCOME15",
                title="Welcome offer: 15% off",
                description="For new customers on their first order",
                kind="percent",
                value=15,
                max_discount=500,
                first_order_only=True,
                per_user_limit=1,
            ),
            Coupon(
                code="FLAT200",
                title="Flat ₹200 off",
                description="On orders of ₹1,999 and above",
                kind="flat",
                value=200,
                min_order=1999,
            ),
            Coupon(
                code="UPI5",
                title="Extra 5% off with UPI",
                description="Pay with any UPI app and save more",
                kind="percent",
                value=5,
                max_discount=150,
                min_order=499,
                payment_methods=["upi"],
            ),
            Coupon(
                code="BIGSAVE",
                title="Big spender: 12% off",
                description="On orders of ₹5,000 and above",
                kind="percent",
                value=12,
                max_discount=1000,
                min_order=5000,
            ),
            Coupon(
                code="FESTIVE20",
                title="Festive sale: 20% off",
                description="Limited-time offer, up to ₹750 off",
                kind="percent",
                value=20,
                max_discount=750,
                min_order=1500,
                expires_at=soon,
            ),
        ]
    )
    db.commit()
    return 6
