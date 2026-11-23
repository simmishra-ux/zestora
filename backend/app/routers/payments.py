import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .. import gateway
from ..database import get_db
from ..mailer import smtp_configured
from ..models import Order, PaymentIntent, User
from ..order_ops import expire_stale_orders
from ..schemas import ConfirmIn, ConfirmOut, IntentIn, IntentOut
from ..security import get_current_user

router = APIRouter(tags=["payments"])


@router.post("/payments/intents", response_model=IntentOut, status_code=201)
def create_intent(body: IntentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Step 1: our server starts a payment for an order. The amount comes from OUR database, never from the browser."""
    expire_stale_orders(db)
    order = db.get(Order, body.order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(404, "Order not found")
    if order.cancelled:
        raise HTTPException(409, "This order was cancelled (unpaid orders are released after 15 minutes).")
    if order.payment_status == "paid":
        raise HTTPException(409, "This order is already paid.")
    if order.payment_method == "cod":
        raise HTTPException(409, "Cash-on-delivery orders are paid when they arrive.")
    intent = PaymentIntent(
        id=f"pi_{secrets.token_hex(8)}", client_secret=secrets.token_urlsafe(24), order_id=order.id, amount=order.total
    )
    order.payment_status = "pending"  # a retry after a failure goes back to pending
    db.add(intent)
    db.commit()
    return {
        "intent_id": intent.id,
        "client_secret": intent.client_secret,
        "amount": intent.amount,
        "method": order.payment_method,
    }


@router.post("/gateway/confirm", response_model=ConfirmOut)
def gateway_confirm(body: ConfirmIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Steps 2-3: THIS ENDPOINT PLAYS THE GATEWAY (Stripe/Razorpay). In real life it lives on their servers, which is
    why it takes no login of ours: the intent id + client secret are its credentials. It decides the outcome and
    notifies our webhook with a signed event. The browser only gets a friendly message, which proves nothing."""
    intent = db.get(PaymentIntent, body.intent_id)
    if not intent or not secrets.compare_digest(intent.client_secret, body.client_secret):
        raise HTTPException(404, "Unknown payment")
    if intent.status != "requires_payment":
        return {"status": intent.status, "message": "This payment was already processed."}
    ok, message = gateway.judge(body)
    raw = gateway.build_event(intent, ok, message)
    gateway.deliver_webhook(db, raw, gateway.sign(raw), background)  # in real life: an HTTP POST from their servers to ours
    if ok and db.get(Order, intent.order_id).cancelled:  # paid too late: the order had already expired
        return {
            "status": "failed",
            "message": "This order expired before your payment arrived, so it was cancelled and the payment refunded.",
        }
    return {
        "status": "succeeded" if ok else "failed",
        "message": message,
        "email_status": ("queued" if smtp_configured() else "saved-locally") if ok else None,
    }


@router.post("/webhooks/payment")
async def payment_webhook(
    request: Request, background: BackgroundTasks, db: Session = Depends(get_db), x_gateway_signature: str = Header(default="")
):
    """Step 4: the public webhook a real gateway would call. No login; the HMAC signature IS the authentication.
    We verify the RAW bytes (re-serialising JSON could change them and break the signature)."""
    return gateway.deliver_webhook(db, await request.body(), x_gateway_signature, background)
