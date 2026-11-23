"""A MOCK payment gateway (think Stripe/Razorpay in test mode). No money, no accounts, same architecture.

The flow, exactly as with a real gateway:
  1. Our server creates a payment intent for an order (routers/payments.py).
  2. The BROWSER sends card/UPI details to the GATEWAY (never to our own order logic).
  3. The gateway decides success/failure and tells OUR server via a SIGNED webhook.
  4. Our server verifies the signature and ONLY THEN marks the order paid.
Step 4 is the lesson: the browser saying "I paid" can never be trusted; only the gateway's signed message can."""

import hmac
import json
import logging
import os
import re
from datetime import UTC, datetime
from hashlib import sha256

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from .mailer import send_order_confirmation
from .models import Order, PaymentIntent
from .schemas import ConfirmIn, OrderOut

log = logging.getLogger("zestora.gateway")
DECLINES = {"4000000000000002": "Your card was declined.", "4000000000009995": "Insufficient funds."}  # Stripe-style test cards


def secret() -> bytes:
    # Shared between "gateway" and "shop". In production: a long random value from the environment.
    return os.getenv("GATEWAY_WEBHOOK_SECRET", "whsec_dev_only_change_me").encode()


def sign(raw: bytes) -> str:
    return hmac.new(secret(), raw, sha256).hexdigest()


def verify(raw: bytes, signature: str) -> bool:
    return hmac.compare_digest(sign(raw), signature or "")  # constant-time compare: no timing side channel


def judge(body: ConfirmIn) -> tuple[bool, str]:
    """The gateway's decision. Malformed input is a 422 (like a real gateway rejecting the form); a decline is a result."""
    if body.method == "card":
        number = re.sub(r"\s", "", body.card_number)
        m = re.fullmatch(r"(0[1-9]|1[0-2])/(\d{2})", body.expiry)
        if not re.fullmatch(r"\d{16}", number):
            raise HTTPException(422, "Enter a valid 16-digit card number.")
        if not m or (2000 + int(m[2]), int(m[1])) < (datetime.now(UTC).year, datetime.now(UTC).month):
            raise HTTPException(422, "Enter a valid, unexpired expiry date (MM/YY).")
        if not re.fullmatch(r"\d{3}", body.cvv):
            raise HTTPException(422, "Enter the 3-digit CVV.")
        return (False, DECLINES[number]) if number in DECLINES else (True, "Payment successful.")
    if not re.fullmatch(r"[\w.\-]{2,}@[a-zA-Z]{2,}", body.vpa):
        raise HTTPException(422, "Enter a valid UPI ID, like name@bank.")
    return (False, "The bank declined this UPI payment.") if body.vpa.lower() == "fail@upi" else (True, "Payment successful.")


def build_event(intent: PaymentIntent, ok: bool, reason: str) -> bytes:
    event = {
        "id": f"evt_{os.urandom(6).hex()}",
        "type": "payment.succeeded" if ok else "payment.failed",
        "intentId": intent.id,
        "orderId": intent.order_id,
        "amount": intent.amount,
        "reason": None if ok else reason,
    }
    return json.dumps(event, separators=(",", ":")).encode()


def deliver_webhook(db: Session, raw: bytes, signature: str, background: BackgroundTasks) -> dict:
    """OUR side of the webhook: verify, validate, update the order. Used by the public /webhooks/payment route
    (what a real gateway would call over HTTP) and by the mock gateway itself."""
    if not verify(raw, signature):
        raise HTTPException(400, "Invalid signature")  # forged or tampered: do nothing
    event = json.loads(raw)
    intent = db.get(PaymentIntent, event.get("intentId", ""))
    order = db.get(Order, event.get("orderId", ""))
    if not intent or not order or intent.order_id != order.id:
        raise HTTPException(404, "Unknown payment")
    if event.get("amount") != intent.amount or intent.amount != order.total:
        log.error("Amount mismatch on %s", intent.id)
        raise HTTPException(400, "Amount mismatch")  # never accept a payment for a different amount than the order total
    if intent.status != "requires_payment":
        return {"received": True, "duplicate": True}  # gateways RETRY webhooks, so handling must be idempotent

    if event["type"] == "payment.succeeded":
        intent.status = "succeeded"
        if order.cancelled:
            order.payment_status = "refunded"  # money arrived after we released the order: auto-refund, don't resurrect it
        else:
            order.payment_status, order.paid_at, order.payment_id = "paid", datetime.now(UTC), intent.id
            from .routers.orders import to_out  # local import: avoids a circular import at module load

            snapshot = OrderOut.model_validate(to_out(order)).model_dump(by_alias=True, mode="json")
            background.add_task(send_order_confirmation, snapshot, order.contact_email or order.user.email, order.user.name)
    else:
        intent.status = "failed"
        if not order.cancelled:
            order.payment_status = "failed"  # the customer can retry from the order page
    db.commit()
    return {"received": True}
