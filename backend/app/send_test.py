"""Check your Gmail settings without placing an order:   .venv/bin/python -m app.send_test you@gmail.com"""

import smtplib
import sys

from .mailer import _cfg, build_message

to = sys.argv[1] if len(sys.argv) > 1 else _cfg()["user"]
c = _cfg()
if not (c["user"] and c["password"]):
    sys.exit("SMTP_USER / SMTP_PASSWORD are not set in backend/.env yet.")

order = {
    "id": "ZSTEST001",
    "paymentMethod": "upi",
    "couponCode": None,
    "address": {"name": "Test", "line1": "1 Test Street", "city": "Pune", "state": "MH", "pincode": "411001"},
    "items": [{"title": "Test product", "qty": 1, "price": 999}],
    "totals": {"subtotal": 999, "couponDiscount": 0, "delivery": 49, "total": 1048},
}
try:
    with smtplib.SMTP(c["host"], c["port"], timeout=15) as s:
        s.starttls()
        s.login(c["user"], c["password"])
        s.send_message(build_message(order, to, "there"))
    print(f"✓ Sent a test confirmation to {to}. Check the inbox (and Spam).")
except smtplib.SMTPAuthenticationError:
    sys.exit(
        "✗ Gmail rejected the login. Use a 16-character App Password (2-Step Verification must be on), not your normal password."
    )
except Exception as e:
    sys.exit(f"✗ Could not send: {e}")
