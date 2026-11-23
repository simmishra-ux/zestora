"""The support assistant: a rule-based chatbot that answers from the shop's REAL data and hands over to a human when needed.

Why rule-based? It is deterministic (easy to test), works offline, needs no API key and can never invent a refund policy.
The seam for an LLM is the single function `respond()`: give it the customer's text and it returns a `BotReply`.
Swap its body for a model call and nothing else (routers, database, UI) has to change.

Honesty rule: the bot only states policies that exist in this code (delivery fee, the 15-minute payment hold,
cancel-before-shipping). Things the app can't do yet (password reset, return pickups) are handed to a person."""

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from .coupons import is_live, terms
from .mailer import inr
from .models import Coupon, Order, Product, User
from .order_ops import PAYMENT_WINDOW
from .pricing import DELIVERY_FEE, FREE_DELIVERY_THRESHOLD
from .status import KEYS, aware, status_index

ORDER_ID = re.compile(r"\bZS\d{8}\b", re.I)
MENU = ["Where is my order?", "Payment problem", "Quality issue", "Return or replacement", "Talk to a person"]
STATUS_LABELS = {
    "placed": "Order placed",
    "packed": "Packed",
    "shipped": "Shipped",
    "out": "Out for delivery",
    "delivered": "Delivered",
}
PAYMENT_MINUTES = int(PAYMENT_WINDOW.total_seconds() // 60)

KEYWORDS = {
    "human": [
        "human",
        "agent",
        "person",
        "representative",
        "someone",
        "customer care",
        "customer service",
        "executive",
        "call me",
        "speak to",
        "talk to",
    ],
    "policy": [
        "delivery charge",
        "delivery fee",
        "shipping charge",
        "shipping fee",
        "free delivery",
        "return policy",
        "refund policy",
        "replacement policy",
    ],
    "payment": [
        "payment",
        "paid",
        "pay",
        "money",
        "deducted",
        "charged",
        "debited",
        "refund",
        "upi",
        "card",
        "transaction",
        "declined",
        "double charge",
        "amount",
    ],
    "quality": [
        "damaged",
        "damage",
        "broken",
        "defect",
        "defective",
        "quality",
        "fake",
        "not working",
        "stopped working",
        "wrong item",
        "wrong product",
        "missing",
        "torn",
        "dirty",
        "expired",
        "leaking",
        "scratch",
        "cracked",
        "bad product",
        "poor",
    ],
    "cancel": ["cancel"],
    "return": ["return", "replace", "replacement", "exchange"],
    "tracking": [
        "where is",
        "track",
        "status",
        "delivery",
        "deliver",
        "delivered",
        "arrive",
        "delay",
        "late",
        "shipping",
        "shipped",
        "when will",
        "dispatch",
        "not received",
    ],
    "coupon": ["coupon", "promo", "voucher", "discount code", "offer code", "code"],
    "product": [
        "stock",
        "available",
        "availability",
        "warranty",
        "size",
        "spec",
        "specification",
        "compare",
        "recommend",
        "price of",
        "cost of",
        "do you have",
        "do you sell",
    ],
    "account": ["login", "log in", "password", "sign in", "signin", "sign up", "signup", "account", "profile", "forgot"],
    "thanks": ["thanks", "thank you", "thx", "helpful"],
    "greeting": ["hi", "hello", "hey", "good morning", "good evening", "namaste"],
}
# When two intents score the same, the earlier one wins (a request for a person beats everything).
PRIORITY = [
    "human",
    "policy",
    "payment",
    "quality",
    "cancel",
    "return",
    "tracking",
    "coupon",
    "product",
    "account",
    "thanks",
    "greeting",
]
PAYMENT_ISSUE = (
    "fail",
    "deduct",
    "charged",
    "debited",
    "refund",
    "declined",
    "stuck",
    "pending",
    "double",
    "twice",
    "not received",
    "unsuccessful",
    "error",
    "problem",
    "issue",
    "trouble",
)
MONEY_TAKEN = ("deduct", "charged", "debited", "double", "twice", "cut from", "taken")
STOPWORDS = frozenset(
    [
        "the",
        "a",
        "an",
        "is",
        "are",
        "do",
        "you",
        "have",
        "sell",
        "any",
        "about",
        "for",
        "of",
        "to",
        "my",
        "me",
        "i",
        "in",
        "on",
        "and",
        "or",
        "with",
        "what",
        "how",
        "much",
        "price",
        "cost",
        "stock",
        "available",
        "availability",
        "warranty",
        "size",
        "spec",
        "specification",
        "compare",
        "recommend",
        "can",
        "there",
        "it",
        "this",
        "that",
        "please",
        "tell",
        "show",
    ]
)


@dataclass
class BotReply:
    text: str
    quick_replies: list[str] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)
    intent: str = "unknown"
    escalate: bool = False
    category: str | None = None
    order_id: str | None = None
    state: dict = field(default_factory=dict)  # saved on the thread so the next message has context


def detect(t: str) -> str:
    """Pick the intent whose keywords appear most often. `t` is lower-case text padded with spaces."""
    scores = {}
    for intent, words in KEYWORDS.items():
        scores[intent] = sum(1 for w in words if re.search(rf"\b{re.escape(w)}{'(?:s|es)?' if len(w) > 3 else ''}\b", t))
    best = max(PRIORITY, key=lambda i: (scores[i], -PRIORITY.index(i)))
    return best if scores[best] else "unknown"


# ---------------------------------------------------------------- data helpers (always scoped to the logged-in user)
def _own_order(db: Session, user: User, order_id: str) -> Order | None:
    return db.scalar(select(Order).where(Order.id == order_id, Order.user_id == user.id))


def _recent_orders(db: Session, user: User, n: int = 4) -> list[Order]:
    return list(db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(n)))


def _label(order: Order) -> str:
    idx = status_index(order)
    return "Cancelled" if idx == -1 else STATUS_LABELS[KEYS[idx]]


def _order_link(order: Order, label: str = "Open order") -> dict:
    return {"label": f"{label} {order.id}", "to": f"/orders/{order.id}"}


def _first_name(user: User | None) -> str:
    return user.name.split()[0] if user and user.name else "there"


# ---------------------------------------------------------------- the conversation
def respond(text: str, user: User | None, db: Session, state: dict) -> BotReply:
    t = " " + re.sub(r"\s+", " ", text.lower().strip()) + " "
    ids = [i.upper() for i in ORDER_ID.findall(text)]
    intent = detect(t)
    awaiting = state.get("awaiting")
    fallbacks = state.get("fallbacks", 0)

    # The customer answered "which order?" with an order number: carry on with what they were asking about.
    resumed = False
    if ids and awaiting == "order" and intent in ("unknown", "greeting", "thanks"):
        intent, resumed = state.get("intent", "tracking"), True
        if state.get("deducted"):
            t += "deducted "  # they said money was taken; the order number alone must not make us forget that
    if ids and intent == "unknown":
        intent = "tracking"
    no_order = bool(awaiting == "order" and re.search(r"don'?t have|no order|not about an order|skip|haven'?t ordered", t))
    if no_order:
        intent = state.get("intent", "other")

    # Follow-ups like "money was deducted" refer to the order we were just discussing (tracking always asks afresh).
    about_a_problem = intent != "payment" or any(w in t for w in PAYMENT_ISSUE)
    if (
        not ids
        and not no_order
        and about_a_problem
        and intent in ("payment", "quality", "return", "cancel")
        and state.get("order_id")
    ):
        ids = [state["order_id"]]

    reply = _dispatch(intent, t, ids, user, db, state, no_order, resumed)
    reply.intent = intent
    if reply.state.get("awaiting") == "order" and any(w in t for w in MONEY_TAKEN):
        reply.state["deducted"] = True  # remembered while we ask which order
    if reply.order_id:
        reply.state["order_id"] = reply.order_id  # remembered for the next message
    if reply.intent == "unknown":
        reply.state = {"fallbacks": fallbacks + 1}
        if fallbacks + 1 >= 2 and user:  # two misses in a row: stop guessing and bring in a person
            return BotReply(
                "I'm sorry, I'm still not getting it. Let me pass this to our support team so a person can help you.",
                intent="unknown",
                escalate=True,
                category="other",
                state={},
            )
    else:
        reply.state.setdefault("fallbacks", 0)
        reply.state.setdefault("intent", intent)
    return reply


def _need_login(what: str) -> BotReply:
    return BotReply(
        f"To {what} I need to know who you are. Please log in and ask me again here, and I'll look at your orders.",
        quick_replies=["Delivery charges", "How do coupons work?"],
        links=[{"label": "Log in", "to": "/login"}],
    )


def _ask_which_order(intent: str, user: User, db: Session, prompt: str) -> BotReply:
    orders = _recent_orders(db, user)
    if not orders:
        return BotReply(
            "You haven't placed any orders yet, so there's nothing to look up. Browse the shop whenever you're ready!",
            links=[{"label": "Browse products", "to": "/products"}],
            state={"awaiting": None},
        )
    chips = [o.id for o in orders] + (["I don't have an order number"] if intent in ("quality", "payment", "return") else [])
    return BotReply(prompt, quick_replies=chips, state={"awaiting": "order", "intent": intent})


def _dispatch(
    intent: str, t: str, ids: list[str], user: User | None, db: Session, state: dict, no_order: bool, resumed: bool = False
) -> BotReply:
    first = _first_name(user)

    if intent == "greeting":
        return BotReply(f"Hi {first}! I'm Zestora's help assistant. What can I help you with?", quick_replies=MENU)
    if intent == "thanks":
        return BotReply("You're welcome! Is there anything else I can help with?", quick_replies=["No, that's all", *MENU[:3]])
    if intent == "human":
        if not user:
            return _need_login("connect you with our team")
        return BotReply(
            "Of course. I'm passing this conversation to our support team. A person will reply here.",
            escalate=True,
            category=_category(state.get("intent")),
            order_id=ids[0] if ids else state.get("order_id"),
        )
    if intent == "policy":
        return BotReply(
            f"Delivery is free on orders of {inr(FREE_DELIVERY_THRESHOLD)} or more; below that there's a {inr(DELIVERY_FEE)} fee. "
            f"Products come with a 7-day replacement window, and an order can be cancelled any time before it ships.",
            quick_replies=["Return or replacement", "Where is my order?"],
        )
    if intent == "coupon":
        return _coupon(t, db)
    if intent == "product":
        return _product(t, db)
    if intent == "account":
        return BotReply(
            "You can sign up or log in from the top right, and edit your details and addresses on your profile page. "
            "Password reset isn't available yet. If you're locked out, I can ask our team to help.",
            quick_replies=["Talk to a person"],
            links=[{"label": "My profile", "to": "/profile"}],
        )

    # ----- everything below is about a specific order -----
    if intent in ("tracking", "payment", "quality", "return", "cancel"):
        if intent == "payment" and not ids and not resumed and not any(w in t for w in PAYMENT_ISSUE):  # a general question
            return BotReply(
                "We accept UPI, cards and cash on delivery. For online payments the order is held for "
                f"{PAYMENT_MINUTES} minutes while you pay, then released. What's going on with your payment?",
                quick_replies=["My payment failed", "Money was deducted", "Refund status"],
            )
        if not user:
            return _need_login(
                {
                    "tracking": "check an order",
                    "payment": "look at a payment",
                    "quality": "raise a quality issue",
                    "return": "arrange a return or replacement",
                    "cancel": "cancel an order",
                }[intent]
            )
        if no_order:  # "I don't have an order number": raise it generally
            return _raise(intent, None, "Understood. I'll raise this with our team so they can look into it with you.")
        order = _own_order(db, user, ids[0]) if ids else None
        if ids and not order:  # not found, OR it belongs to someone else: we never reveal which
            if not _recent_orders(db, user, 1):
                return BotReply(
                    f"I couldn't find order {ids[0]} on your account. You haven't placed any orders yet.",
                    links=[{"label": "Browse products", "to": "/products"}],
                    state={"awaiting": None},
                )
            return _ask_which_order(
                intent, user, db, f"I couldn't find order {ids[0]} on your account. Please pick one of your orders:"
            )
        if not order:
            prompt = {
                "tracking": "Which order would you like me to check?",
                "payment": "Which order is the payment for?",
                "quality": "I'm sorry about that. Which order is it about?",
                "return": "Happy to help. Which order is it about?",
                "cancel": "Which order would you like to cancel?",
            }[intent]
            return _ask_which_order(intent, user, db, prompt)
        return {"tracking": _tracking, "payment": _payment, "quality": _quality, "return": _quality, "cancel": _cancel}[intent](
            order, t, intent
        )

    return BotReply(
        "I'm not sure I understood that. I can check an order, help with a payment, handle a quality issue, or arrange a return. What do you need?",
        quick_replies=MENU,
    )


def _category(intent: str | None) -> str:
    return {"payment": "payment", "quality": "quality", "return": "return", "tracking": "delivery", "cancel": "other"}.get(
        intent or "", "other"
    )


def _raise(intent: str, order: Order | None, text: str) -> BotReply:
    return BotReply(
        text,
        escalate=True,
        category=_category(intent),
        order_id=order.id if order else None,
        links=[_order_link(order)] if order else [],
    )


def _tracking(order: Order, t: str, intent: str) -> BotReply:
    when = aware(order.created_at).strftime("%d %b %Y")
    pay = {
        "paid": "paid",
        "cod": "cash on delivery",
        "pending": "payment pending",
        "failed": "payment failed",
        "refunded": "refunded",
        "expired": "payment not completed",
        "void": "cancelled",
    }.get(order.payment_status, order.payment_status)
    text = f"Order {order.id} (placed {when}) is currently: {_label(order)}. Payment: {pay}."
    chips = ["Report a problem with this order"]
    if status_index(order) in (0, 1):
        chips.insert(0, "Cancel this order")
    if order.payment_status in ("pending", "failed") and not order.cancelled:
        text += f" It's still waiting for payment, and unpaid orders are released after {PAYMENT_MINUTES} minutes."
        chips = ["My payment failed"]
    return BotReply(
        text, quick_replies=chips, links=[_order_link(order)], order_id=order.id, state={"awaiting": None, "order_id": order.id}
    )


def _payment(order: Order, t: str, intent: str) -> BotReply:
    status, link = order.payment_status, [_order_link(order)]
    deducted = any(w in t for w in MONEY_TAKEN)
    if status == "cod":
        return BotReply(
            f"Order {order.id} is cash on delivery, so nothing is charged online. You pay when it arrives.",
            links=link,
            order_id=order.id,
        )
    if status in ("pending", "failed") and not order.cancelled:
        if deducted:
            return _raise(
                intent,
                order,
                f"Thanks for telling me. Order {order.id} still shows as '{status}' on our side, so I'm raising "
                "the deduction with our team to check it against the payment provider.",
            )
        how = "The last attempt failed" if status == "failed" else "The payment hasn't been completed yet"
        return BotReply(
            f"{how} for order {order.id}. Open the order and choose 'Pay now' to try again. It's held for {PAYMENT_MINUTES} minutes "
            "from when it was placed, then released.",
            quick_replies=["Money was deducted", "Talk to a person"],
            links=link,
            order_id=order.id,
        )
    if status == "paid":
        if deducted:
            return _raise(
                intent,
                order,
                f"I can see order {order.id} was paid once. Since you believe you were charged incorrectly, "
                "I'm raising it with our team to check the transactions.",
            )
        when = aware(order.paid_at).strftime("%d %b %Y") if order.paid_at else "earlier"
        return BotReply(
            f"Payment for order {order.id} was received on {when}. Is something wrong with it?",
            quick_replies=["Charged twice", "Talk to a person"],
            links=link,
            order_id=order.id,
        )
    if status == "refunded":
        if deducted:  # they say they were charged, yet our records say refunded: a person must check the transactions
            return _raise(
                intent,
                order,
                f"Order {order.id} shows as refunded on our side, so I'm raising the charge you mention with our team to check the transactions.",
            )
        return BotReply(
            f"Order {order.id} was cancelled after it was paid, so the payment has been marked as refunded to your original payment method.",
            quick_replies=["Talk to a person"],
            links=link,
            order_id=order.id,
        )
    # expired / void: never paid
    if deducted:
        return _raise(
            intent,
            order,
            f"Order {order.id} was never completed, so no payment should have been taken. I'm raising the charge you "
            "mention with our team right away.",
        )
    return BotReply(
        f"Order {order.id} wasn't paid in time, so it was cancelled and the items went back on sale. No payment was taken.",
        quick_replies=["Money was deducted"],
        links=link,
        order_id=order.id,
    )


def _quality(order: Order, t: str, intent: str) -> BotReply:
    what = "return or replacement request" if intent == "return" else "quality complaint"
    return _raise(
        intent,
        order,
        f"I'm really sorry about that. I've logged a {what} for order {order.id} and passed it to our team. "
        "Please describe the problem in a message here (what's wrong, and which item). Items have a 7-day replacement window.",
    )


def _cancel(order: Order, t: str, intent: str) -> BotReply:
    link = [_order_link(order)]
    if order.cancelled:
        return BotReply(
            f"Order {order.id} is already cancelled. If it was paid, the payment shows as refunded.",
            links=link,
            order_id=order.id,
        )
    if status_index(order) <= 1:
        return BotReply(
            f"Order {order.id} hasn't shipped yet, so you can cancel it. Open the order and choose 'Cancel order'. Stock is released straight away.",
            links=link,
            order_id=order.id,
        )
    return BotReply(
        f"Order {order.id} is already '{_label(order)}', so it can no longer be cancelled. Once it arrives you can ask for a return or replacement.",
        quick_replies=["Return or replacement", "Talk to a person"],
        links=link,
        order_id=order.id,
    )


def _coupon(t: str, db: Session) -> BotReply:
    live = [c for c in db.scalars(select(Coupon)) if is_live(c)]
    for c in live:  # the customer named a specific code
        if re.search(rf"\b{re.escape(c.code.lower())}\b", t):
            return BotReply(
                f"{c.code}: {c.title}. " + ("; ".join(terms(c)) or "No other conditions.") + ".",
                quick_replies=["How do coupons work?"],
                links=[{"label": "Go to cart", "to": "/cart"}],
            )
    return BotReply(
        "Offers appear in your cart and again on the payment step, each with what you'd save, or the reason it doesn't apply yet. "
        "The usual reasons are a minimum order value, a specific payment method (like UPI), first-order-only offers, or an expired offer.",
        links=[{"label": "Go to cart", "to": "/cart"}],
    )


def _product(t: str, db: Session) -> BotReply:
    words = [
        w
        for w in re.findall(r"[a-z0-9]+", t)
        if len(w) >= 3 and w not in STOPWORDS and w not in {x for ws in KEYWORDS.values() for x in ws}
    ]
    if not words:
        return BotReply(
            "Which product are you asking about? Tell me its name and I'll look it up.", quick_replies=["Delivery charges"]
        )
    q = select(Product).where(Product.active.is_(True))
    for w in words:
        like = f"%{w}%"
        q = q.where(Product.title.ilike(like) | Product.brand.ilike(like) | Product.subcategory.ilike(like))
    found = list(db.scalars(q.order_by(Product.reviews.desc()).limit(3)))
    if not found:
        return BotReply(
            "I couldn't find a matching product. Try the search bar, or tell me the name another way.",
            links=[{"label": "Browse products", "to": "/products"}],
        )
    lines = [
        f"• {p.title}: {inr(p.price)}, " + (f"in stock ({p.stock} left)" if p.stock else "currently out of stock") for p in found
    ]
    return BotReply(
        "Here's what I found:\n" + "\n".join(lines), links=[{"label": p.title[:28], "to": f"/products/{p.id}"} for p in found]
    )
