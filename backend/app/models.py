"""ORM models: Python classes that map to database tables."""

import os
import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(15), default="")
    password_hash: Mapped[str] = mapped_column(String)  # bcrypt hash, never the password itself
    # OLD storage (a JSON list). The DB column is still called "addresses" so existing databases keep working;
    # at startup any old entries are copied into the real `addresses` table below (see seed.migrate_legacy_addresses).
    legacy_addresses: Mapped[list] = mapped_column("addresses", JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    orders: Mapped[list["Order"]] = relationship(back_populates="user")

    @property
    def is_admin(self) -> bool:
        """Admins are decided by the ADMIN_EMAILS setting (comma-separated), so no database change is needed.
        PRODUCTION NOTE: this is only safe if emails are VERIFIED at signup; otherwise anyone could register an admin email."""
        admins = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "admin@zestora.dev").split(",") if e.strip()}
        return self.email.lower() in admins

    # One user has MANY addresses (one-to-many). Default address first, then newest.
    addresses: Mapped[list["Address"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by=lambda: (Address.is_default.desc(), Address.created_at.desc()),
    )


class Address(Base):
    __tablename__ = "address_book"  # (not "addresses": that name is the legacy JSON column on users)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    label: Mapped[str] = mapped_column(String(10), default="Home")  # Home / Work / Other
    name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str] = mapped_column(String(10))
    line1: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(60))
    state: Mapped[str] = mapped_column(String(60))
    pincode: Mapped[str] = mapped_column(String(6))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    user: Mapped[User] = relationship(back_populates="addresses")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str] = mapped_column(String(60), index=True)
    category: Mapped[str] = mapped_column(String(40), index=True)
    price: Mapped[int] = mapped_column(Integer)
    mrp: Mapped[int] = mapped_column(Integer)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    rating: Mapped[float] = mapped_column(Float)
    reviews: Mapped[int] = mapped_column(Integer)
    stock: Mapped[int] = mapped_column(Integer)
    emoji: Mapped[str] = mapped_column(String(8))
    hue: Mapped[int] = mapped_column(Integer)
    colors: Mapped[list] = mapped_column(JSON)
    description: Mapped[str] = mapped_column(String)
    highlights: Mapped[list] = mapped_column(JSON)
    added_order: Mapped[int] = mapped_column(Integer)
    subcategory: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    image: Mapped[str | None] = mapped_column(String(200), nullable=True)  # thumbnail used in lists and cards
    images: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")  # the product page gallery
    specs: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")  # label -> value table
    # "Hidden" products are not deleted: old orders still point to them. Admins can show or hide a product at any time.
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    payment_method: Mapped[str] = mapped_column(String(10))
    coupon_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    # pending -> paid | failed (retryable) ;  cod ;  expired / void (never paid) ;  refunded (paid, then cancelled)
    payment_status: Mapped[str] = mapped_column(String(10), default="pending")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_id: Mapped[str | None] = mapped_column(String(40), nullable=True)  # the gateway's intent id
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)  # where the confirmation goes
    address: Mapped[dict] = mapped_column(JSON)  # snapshot: later profile edits must not change old orders
    mrp_total: Mapped[int] = mapped_column(Integer)
    subtotal: Mapped[int] = mapped_column(Integer)
    product_savings: Mapped[int] = mapped_column(Integer)
    coupon_discount: Mapped[int] = mapped_column(Integer)
    delivery: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    item_count: Mapped[int] = mapped_column(Integer)

    user: Mapped[User] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    # Status changes made by an admin. The LAST one wins; with none, status is simulated from the order's age.
    events: Mapped[list["OrderEvent"]] = relationship(cascade="all, delete-orphan", order_by="OrderEvent.id")

    @property
    def admin_status(self) -> str | None:
        return self.events[-1].status if self.events else None


class OrderItem(Base):
    """One row per product in an order. Title/price are COPIED from the product at purchase time."""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    product_id: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str] = mapped_column(String(60))
    emoji: Mapped[str] = mapped_column(String(8))
    hue: Mapped[int] = mapped_column(Integer)
    image: Mapped[str | None] = mapped_column(String(200), nullable=True)  # snapshot of the thumbnail at purchase time
    price: Mapped[int] = mapped_column(Integer)
    qty: Mapped[int] = mapped_column(Integer)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderEvent(Base):
    """A new table = no migration needed. One row per status change an admin makes."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    status: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("product_id", "user_id", name="one_review_per_user_per_product"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(100), default="")
    body: Mapped[str] = mapped_column(String(2000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    user: Mapped[User] = relationship()


class Coupon(Base):
    """A new table (no migration). Rules live in data, so admins can add offers without a code change."""

    __tablename__ = "coupons"

    code: Mapped[str] = mapped_column(String(20), primary_key=True)  # always stored UPPERCASE
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[str] = mapped_column(String(7))  # "percent" or "flat"
    value: Mapped[int] = mapped_column(Integer)  # 10 => 10%  (or ₹10 for flat)
    max_discount: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cap for percent coupons
    min_order: Mapped[int] = mapped_column(Integer, default=0)
    payment_methods: Mapped[list] = mapped_column(JSON, default=list)  # [] = any; else e.g. ["upi"]
    first_order_only: Mapped[bool] = mapped_column(Boolean, default=False)
    per_user_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)  # None = unlimited
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PaymentIntent(Base):
    """One payment attempt for an order (like Stripe's PaymentIntent). A failed card can be retried = a new intent."""

    __tablename__ = "payment_intents"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    client_secret: Mapped[str] = mapped_column(String(64))  # proves the caller is the one we created this payment for
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="requires_payment")  # -> succeeded | failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Meta(Base):
    """Tiny key/value table for housekeeping facts, e.g. which catalog version has been loaded."""

    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class SupportThread(Base):
    """One support conversation. It starts with the bot; if the bot can't solve it, it becomes a ticket for a human."""

    __tablename__ = "support_threads"

    id: Mapped[str] = mapped_column(String(12), primary_key=True)  # also the ticket number, e.g. ZT483920
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    # bot -> waiting_agent (escalated) -> answered (an agent replied) -> resolved.
    # A new customer message on an escalated ticket sends it back to waiting_agent.
    status: Mapped[str] = mapped_column(String(14), default="bot")
    category: Mapped[str | None] = mapped_column(String(12), nullable=True)  # payment | quality | return | delivery | other
    order_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state: Mapped[dict] = mapped_column(
        JSON, default=dict, server_default="{}"
    )  # what the bot is waiting for (e.g. an order number)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    user: Mapped[User] = relationship()
    messages: Mapped[list["SupportMessage"]] = relationship(cascade="all, delete-orphan", order_by="SupportMessage.id")


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("support_threads.id"), index=True)
    sender: Mapped[str] = mapped_column(String(5))  # user | bot | agent
    text: Mapped[str] = mapped_column(String(2000))
    quick_replies: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")  # suggested one-tap answers
    links: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")  # [{label, to}] shown as buttons
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
