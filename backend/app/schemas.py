"""Pydantic schemas = the API's contract. They validate incoming JSON and shape outgoing JSON.
`to_camel` makes Python's snake_case fields appear as camelCase in JSON, which is what JavaScript expects."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, StringConstraints
from pydantic.alias_generators import to_camel


def _as_utc(dt: datetime) -> datetime:
    # SQLite stores datetimes without a timezone. Re-attach UTC so JSON ends in "Z"/"+00:00",
    # otherwise JavaScript would interpret the time as the browser's local time.
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


UtcDateTime = Annotated[datetime, AfterValidator(_as_utc)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ---------- auth ----------
class Address(CamelModel):
    """The address SNAPSHOT stored inside an order (a copy, so later edits to the address book don't change it)."""

    id: str | None = None
    label: str | None = None
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    line1: str = Field(min_length=5, max_length=200)
    city: str = Field(min_length=1, max_length=60)
    state: str = Field(min_length=1, max_length=60)
    pincode: str = Field(pattern=r"^\d{6}$")


class AddressBase(CamelModel):
    label: Literal["Home", "Work", "Other"] = "Home"
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    line1: str = Field(min_length=5, max_length=200)
    city: str = Field(min_length=1, max_length=60)
    state: str = Field(min_length=1, max_length=60)
    pincode: str = Field(pattern=r"^\d{6}$")


class AddressIn(AddressBase):
    is_default: bool = False


class AddressOut(AddressBase):
    id: str
    is_default: bool


class SignupIn(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt only uses the first 72 bytes


class LoginIn(CamelModel):
    email: EmailStr
    password: str


class ProfileUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: str | None = Field(default=None, pattern=r"^([6-9]\d{9})?$")


class UserOut(CamelModel):  # note: no password_hash field, so it can never leak
    id: str
    is_admin: bool
    name: str
    email: str
    phone: str
    addresses: list[AddressOut]
    created_at: UtcDateTime


class AuthOut(CamelModel):
    token: str
    user: UserOut


# ---------- products ----------
class Color(CamelModel):
    name: str
    hex: str


class ProductOut(CamelModel):
    id: str
    title: str
    brand: str
    category: str
    price: int
    mrp: int
    discount: int
    rating: float
    reviews: int
    stock: int
    emoji: str
    hue: int
    colors: list[Color]
    description: str
    highlights: list[str]
    added_order: int
    subcategory: str | None = None
    image: str | None = None  # thumbnail for lists
    images: list[str] = Field(default_factory=list)  # gallery for the product page
    specs: dict[str, str] = Field(default_factory=dict)
    active: bool = True


# ---------- orders ----------
class OrderLineIn(CamelModel):
    product_id: str
    qty: int = Field(ge=1, le=10)


class OrderIn(CamelModel):
    # The client sends WHAT it wants (ids + quantities), never prices. The server looks up prices itself.
    items: list[OrderLineIn] = Field(min_length=1)
    address: Address
    payment_method: str = Field(pattern=r"^(upi|card|cod)$")
    coupon_code: str | None = None
    # Where to send the confirmation. Optional so older clients still work; falls back to the account email.
    email: EmailStr | None = None


class BulkDeleteIn(CamelModel):
    ids: list[str] = Field(min_length=1, max_length=100)  # cap the batch so one request can't hog the server


class Skipped(CamelModel):
    id: str
    reason: str


class BulkDeleteOut(CamelModel):
    deleted: list[str]
    skipped: list[Skipped]


class OrderItemOut(CamelModel):
    id: str = Field(validation_alias="product_id", serialization_alias="id")
    title: str
    brand: str
    emoji: str
    hue: int
    image: str | None = None
    price: int
    qty: int


class Totals(CamelModel):
    mrp_total: int
    subtotal: int
    product_savings: int
    coupon_discount: int
    delivery: int
    total: int
    item_count: int


class OrderOut(CamelModel):
    id: str
    created_at: UtcDateTime
    payment_method: str
    coupon_code: str | None
    cancelled: bool
    payment_status: str = "pending"
    paid_at: UtcDateTime | None = None
    contact_email: str | None = None
    admin_status: str | None = None
    address: dict
    items: list[OrderItemOut]
    totals: Totals
    # Only set on the create-order response: "queued" (handed to Gmail) or "saved-locally" (SMTP not set up).
    email_status: str | None = None


# ---------- reviews ----------
class ReviewIn(CamelModel):
    rating: int = Field(ge=1, le=5)
    title: str = Field(default="", max_length=100)
    body: str = Field(default="", max_length=2000)


class ReviewOut(CamelModel):
    id: str
    rating: int
    title: str
    body: str
    created_at: UtcDateTime
    author: str  # "Priya S." -- we never expose full names or emails publicly
    verified_buyer: bool = True  # only buyers can review, so every review is verified


class ReviewsOut(CamelModel):
    reviews: list[ReviewOut]
    mine: ReviewOut | None = None  # the logged-in user's own review, if any
    can_review: bool = False  # logged in AND bought this product


# ---------- admin ----------
# The shop's categories, plus the old demo ones (books, toys, gourmet) so retired products can still be edited.
CATEGORY_SLUGS = Literal[
    "electronics", "fashion", "accessories", "beauty", "home", "grocery", "sports", "books", "toys", "gourmet"
]


class ProductAdminIn(CamelModel):
    title: str = Field(min_length=2, max_length=200)
    brand: str = Field(min_length=1, max_length=60)
    category: CATEGORY_SLUGS
    price: int = Field(gt=0, le=1_000_000)
    mrp: int = Field(gt=0, le=1_000_000)
    stock: int = Field(ge=0, le=100_000)
    emoji: str = Field(min_length=1, max_length=8, default="📦")
    hue: int = Field(ge=0, le=359, default=260)
    description: str = Field(min_length=10, max_length=2000)
    active: bool = True  # hidden products disappear from the shop but stay in the database


class StatusIn(CamelModel):
    status: Literal["placed", "packed", "shipped", "out", "delivered", "cancelled"]


class AdminOrderOut(OrderOut):
    customer_name: str
    customer_email: str


# ---------- coupons ----------
class OffersIn(CamelModel):
    items: list[OrderLineIn] = Field(default_factory=list, max_length=50)
    payment_method: Literal["upi", "card", "cod"] | None = None  # None until the customer picks one


class OfferOut(CamelModel):
    code: str
    title: str
    description: str
    eligible: bool
    reason: str | None = None  # why it can't be applied right now
    discount: int = 0  # how much it would save on THIS cart (0 if not eligible)
    terms: list[str]
    best: bool = False  # the biggest saving among eligible offers


class OffersOut(CamelModel):
    subtotal: int
    offers: list[OfferOut]


class CouponAdminIn(CamelModel):
    code: str = Field(pattern=r"^[A-Za-z0-9]{3,20}$")
    title: str = Field(min_length=3, max_length=80)
    description: str = Field(default="", max_length=200)
    kind: Literal["percent", "flat"]
    value: int = Field(gt=0, le=100_000)
    max_discount: int | None = Field(default=None, gt=0, le=100_000)
    min_order: int = Field(default=0, ge=0, le=1_000_000)
    payment_methods: list[Literal["upi", "card", "cod"]] = Field(default_factory=list)
    first_order_only: bool = False
    per_user_limit: int | None = Field(default=None, ge=1, le=100)
    active: bool = True
    expires_at: UtcDateTime | None = None


class CouponAdminOut(CouponAdminIn):
    used: int = 0


# ---------- payments (mock gateway) ----------
class IntentIn(CamelModel):
    order_id: str


class IntentOut(CamelModel):
    intent_id: str
    client_secret: str
    amount: int
    method: str


class ConfirmIn(CamelModel):
    intent_id: str
    client_secret: str
    method: Literal["card", "upi"]
    card_number: str = ""
    expiry: str = ""
    cvv: str = ""
    vpa: str = ""


class ConfirmOut(CamelModel):
    status: Literal["succeeded", "failed"]
    message: str
    email_status: str | None = None  # "queued" | "saved-locally" once a confirmation email was triggered


# ---------- support chat ----------
MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class SupportMessageIn(CamelModel):
    text: MessageText


class SupportMessageOut(CamelModel):
    id: int
    sender: Literal["user", "bot", "agent"]
    text: str
    quick_replies: list[str]
    links: list[dict]  # [{label, to}] rendered as buttons
    created_at: UtcDateTime


class SupportThreadOut(CamelModel):
    id: str  # the ticket number
    status: Literal["bot", "waiting_agent", "answered", "resolved"]
    category: str | None
    order_id: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    messages: list[SupportMessageOut]


class AskOut(CamelModel):
    text: str
    quick_replies: list[str]
    links: list[dict]


class SupportThreadSummary(CamelModel):
    id: str
    status: str
    category: str | None
    order_id: str | None
    customer_name: str
    customer_email: str
    last_message: str
    last_sender: str
    message_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class SupportThreadAdminOut(SupportThreadOut):
    customer_name: str
    customer_email: str


class AgentReplyIn(CamelModel):
    text: MessageText


class ThreadActionIn(CamelModel):
    action: Literal["resolve", "reopen"]
