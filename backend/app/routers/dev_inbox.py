"""LEARNING-ONLY dev inbox: lets you read the emails the app "sent" while SMTP isn't configured.
Real teams use tools like Mailpit/MailHog for this. It has no login, so it is disabled unless DEV_INBOX=1
(the default here) and must never be enabled in production."""

import os
import re
from email import message_from_bytes, policy
from html import escape

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from .. import mailer

router = APIRouter(prefix="/dev", tags=["dev"], include_in_schema=False)
ORDER_ID = re.compile(r"^ZS[A-Z0-9]{3,12}$")  # strict whitelist: stops "../../etc/passwd"-style path tricks


def _enabled():
    if os.getenv("DEV_INBOX", "1") != "1":
        raise HTTPException(404)


def _load(path):
    return message_from_bytes(path.read_bytes(), policy=policy.default)


@router.get("/inbox", response_class=HTMLResponse)
def inbox():
    _enabled()
    files = sorted(mailer.OUTBOX.glob("ZS*.eml"), key=lambda p: p.stat().st_mtime, reverse=True) if mailer.OUTBOX.exists() else []
    rows = (
        "".join(
            f'<li><a href="/api/dev/inbox/{p.stem}"><b>{escape(str(_load(p)["Subject"]))}</b><br>'
            f"<small>to {escape(str(_load(p)['To']))}</small></a></li>"
            for p in files
        )
        or "<li>No emails yet. Place an order!</li>"
    )
    return f"""<!doctype html><meta charset=utf-8><title>Zestora dev inbox</title>
<body style="font-family:system-ui;max-width:640px;margin:32px auto;padding:0 16px">
<h2>📬 Dev inbox <small style="font-weight:400;color:#888">(learning mode)</small></h2>
<p style="color:#666">Emails the app would send via Gmail appear here while SMTP isn't configured.</p>
<ul style="line-height:1.8">{rows}</ul></body>"""


@router.get("/inbox/{order_id}", response_class=HTMLResponse)
def read_email(order_id: str):
    _enabled()
    path = mailer.OUTBOX / f"{order_id}.eml"
    if not ORDER_ID.match(order_id) or not path.exists():
        raise HTTPException(404, "Email not found")
    msg = _load(path)
    head = (
        f'<div style="font:13px system-ui;background:#f4f1ff;padding:12px 16px;border-bottom:1px solid #ddd">'
        f"<b>To:</b> {escape(str(msg['To']))} &nbsp; <b>From:</b> {escape(str(msg['From']))}<br>"
        f'<b>Subject:</b> {escape(str(msg["Subject"]))} &nbsp; <a href="/api/dev/inbox">← inbox</a></div>'
    )
    return head + msg.get_body(("html",)).get_content()
