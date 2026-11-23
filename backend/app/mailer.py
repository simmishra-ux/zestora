"""Order-confirmation emails.

Delivery modes (chosen automatically):
  * SMTP_USER + SMTP_PASSWORD set  -> really sends through Gmail's SMTP server.
  * not set                        -> writes the email to backend/outbox/<order>.eml so you can open and inspect it.
Either way a failure here is logged and NEVER breaks the order: the customer already paid, so the order must stand.
"""

import logging
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")  # reads backend/.env if it exists
log = logging.getLogger("zestora.mailer")

OUTBOX = Path(os.getenv("OUTBOX_DIR", Path(__file__).resolve().parent.parent / "outbox"))


def _cfg():
    # Read at call time (not import time) so tests and .env edits behave predictably.
    user = os.getenv("SMTP_USER", "")
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": os.getenv("SMTP_PASSWORD", ""),
        "sender": os.getenv("MAIL_FROM", user or "orders@zestora.local"),
        "app_url": os.getenv("APP_URL", "http://localhost:4200").rstrip("/"),
    }


def smtp_configured() -> bool:
    c = _cfg()
    return bool(c["user"] and c["password"])


def inr(n: int) -> str:
    """Indian digit grouping: 1234567 -> ₹12,34,567."""
    s = str(int(n))
    head, tail = s[:-3], s[-3:]
    if head:
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        tail = ",".join(parts) + "," + tail
    return f"₹{tail}"


def build_message(order: dict, to: str, customer_name: str) -> EmailMessage:
    """`order` is the plain dict produced by OrderOut (camelCase keys). Every user-supplied value is HTML-escaped."""
    c = _cfg()
    t, a = order["totals"], order["address"]
    link = f"{c['app_url']}/orders/{order['id']}"
    pay = {"upi": "UPI", "card": "Card", "cod": "Cash on delivery"}.get(order["paymentMethod"], order["paymentMethod"])
    addr_line = f"{a['name']}, {a['line1']}, {a['city']}, {a['state']} – {a['pincode']}"

    lines = [
        f"Hi {customer_name},",
        "",
        "Thank you for your order! We've received it and will start packing it right away.",
        "",
        f"Order number: #{order['id']}",
        "",
        "Items",
    ]
    lines += [f"  {i['qty']} × {i['title']}  –  {inr(i['price'] * i['qty'])}" for i in order["items"]]
    lines += ["", f"Subtotal: {inr(t['subtotal'])}"]
    if t["couponDiscount"]:
        lines.append(f"Coupon ({order['couponCode']}): -{inr(t['couponDiscount'])}")
    lines += [
        f"Delivery: {inr(t['delivery']) if t['delivery'] else 'FREE'}",
        f"Total: {inr(t['total'])}",
        "",
        f"Payment: {pay}",
        f"Delivering to: {addr_line}",
        "",
        f"Track your order: {link}",
        "",
        "– Team Zestora",
    ]

    rows = "".join(
        f'<tr><td style="padding:8px 0;border-bottom:1px solid #ebe7f7">{i["qty"]} × {escape(i["title"])}</td>'
        f'<td align="right" style="padding:8px 0;border-bottom:1px solid #ebe7f7">{inr(i["price"] * i["qty"])}</td></tr>'
        for i in order["items"]
    )
    coupon = (
        f'<tr><td>Coupon ({escape(order["couponCode"])})</td><td align="right">-{inr(t["couponDiscount"])}</td></tr>'
        if t["couponDiscount"]
        else ""
    )
    html = f"""<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#14112b">
  <div style="background:linear-gradient(135deg,#6c4cff,#ff5d8f);padding:24px;border-radius:16px 16px 0 0;color:#fff">
    <div style="font-size:22px;font-weight:800">zestora</div>
    <div style="font-size:20px;margin-top:8px">Order confirmed 🎉</div>
  </div>
  <div style="border:1px solid #ebe7f7;border-top:0;padding:24px;border-radius:0 0 16px 16px">
    <p>Hi {escape(customer_name)}, thank you for your order! We've received it and will start packing it right away.</p>
    <p style="background:#efeaff;padding:12px;border-radius:10px"><b>Order #{escape(order["id"])}</b></p>
    <table width="100%" cellspacing="0" style="font-size:14px">{rows}
      <tr><td style="padding-top:12px">Subtotal</td><td align="right" style="padding-top:12px">{inr(t["subtotal"])}</td></tr>{coupon}
      <tr><td>Delivery</td><td align="right">{inr(t["delivery"]) if t["delivery"] else "FREE"}</td></tr>
      <tr style="font-weight:bold;font-size:16px"><td style="padding-top:8px">Total</td><td align="right" style="padding-top:8px">{inr(t["total"])}</td></tr>
    </table>
    <p style="font-size:14px"><b>Payment:</b> {pay}<br><b>Delivering to:</b> {escape(addr_line)}</p>
    <p><a href="{link}" style="background:#6c4cff;color:#fff;padding:12px 22px;border-radius:99px;text-decoration:none;display:inline-block">Track your order</a></p>
    <p style="color:#7d7a96;font-size:12px">This is a demo store – no real payment was taken.</p>
  </div></div>"""

    msg = EmailMessage()
    msg["Subject"] = f"Order confirmed – #{order['id']} | Zestora"
    msg["From"] = formataddr(("Zestora", c["sender"]))
    msg["To"] = to
    msg.set_content("\n".join(lines))  # plain-text part (for clients that block HTML)
    msg.add_alternative(html, subtype="html")  # rich part
    return msg


def send_order_confirmation(order: dict, to: str, customer_name: str) -> None:
    """Called from a FastAPI BackgroundTask, i.e. after the HTTP response has already been sent."""
    try:
        msg = build_message(order, to, customer_name)
        c = _cfg()
        if smtp_configured():
            with smtplib.SMTP(c["host"], c["port"], timeout=15) as smtp:
                smtp.starttls()  # upgrade to an encrypted connection BEFORE sending the password
                smtp.login(c["user"], c["password"])
                smtp.send_message(msg)
            log.info("Confirmation email sent for %s", order["id"])
        else:
            OUTBOX.mkdir(parents=True, exist_ok=True)
            path = OUTBOX / f"{order['id']}.eml"
            path.write_bytes(bytes(msg))
            log.warning("SMTP not configured – saved confirmation email to %s", path)
    except Exception:  # noqa: BLE001 – deliberately broad: email must never break checkout
        log.exception("Could not send confirmation email for %s", order.get("id"))
