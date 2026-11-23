"""Support chat for customers. Logged-in customers get a saved conversation (and a ticket if the bot hands over).
Guests can ask the bot general questions; nothing about them is stored."""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SupportMessage, SupportThread, User, now
from ..schemas import AskOut, SupportMessageIn, SupportThreadOut
from ..security import get_current_user, get_optional_user
from ..support_bot import respond

router = APIRouter(prefix="/support", tags=["support"])

MAX_MESSAGES_PER_THREAD = 200
MAX_MESSAGES_PER_MINUTE = 15  # a person types slower than this; a script doesn't


def add_message(
    thread: SupportThread, sender: str, text: str, quick_replies: list | None = None, links: list | None = None
) -> None:
    thread.messages.append(SupportMessage(sender=sender, text=text, quick_replies=quick_replies or [], links=links or []))


def latest_thread(db: Session, user: User) -> SupportThread | None:
    return db.scalar(
        select(SupportThread).where(SupportThread.user_id == user.id).order_by(SupportThread.created_at.desc()).limit(1)
    )


def _new_ticket_id(db: Session) -> str:
    while True:
        ticket = f"ZT{secrets.randbelow(10**6):06d}"
        if not db.get(SupportThread, ticket):
            return ticket


def _throttle(db: Session, user: User) -> None:
    cutoff = datetime.now(UTC) - timedelta(seconds=60)
    recent = db.scalar(
        select(func.count()).select_from(SupportMessage).join(SupportThread, SupportThread.id == SupportMessage.thread_id)
        .where(SupportThread.user_id == user.id, SupportMessage.sender == "user", SupportMessage.created_at > cutoff)
    )  # fmt: skip
    if recent >= MAX_MESSAGES_PER_MINUTE:
        raise HTTPException(429, "You're sending messages very quickly. Please wait a moment and try again.")


@router.get("/thread", response_model=SupportThreadOut | None)
def my_thread(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The customer's latest conversation (or null if they have never written to us)."""
    return latest_thread(db, user)


@router.post("/messages", response_model=SupportThreadOut)
def send_message(body: SupportMessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _throttle(db, user)
    thread = latest_thread(db, user)
    if thread is None or thread.status == "resolved":  # a resolved conversation stays closed; a new message starts a fresh one
        thread = SupportThread(id=_new_ticket_id(db), user_id=user.id, status="bot", state={})
        db.add(thread)
    if len(thread.messages) >= MAX_MESSAGES_PER_THREAD:
        raise HTTPException(409, "This conversation is very long. Please wait for our team to reply.")

    add_message(thread, "user", body.text)
    if thread.status in ("waiting_agent", "answered"):
        thread.status = "waiting_agent"  # a person is handling it: the bot stays out, the ticket goes back to the team's inbox
    else:
        reply = respond(body.text, user, db, dict(thread.state or {}))
        add_message(thread, "bot", reply.text, reply.quick_replies, reply.links)
        thread.state = reply.state  # reassigned (not mutated) so SQLAlchemy notices the JSON changed
        if reply.escalate:
            thread.status, thread.category = "waiting_agent", reply.category
            thread.order_id = reply.order_id or thread.order_id
            ticket_note = (
                f"Ticket {thread.id} is now with our support team. "
                "You can keep adding details here, and their replies will appear in this window."
            )
            add_message(thread, "bot", ticket_note)
    thread.updated_at = now()
    db.commit()
    return thread


@router.post("/ask", response_model=AskOut)
def ask(body: SupportMessageIn, user: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    """For visitors who are not logged in: general answers only, nothing is saved."""
    if user is not None:
        raise HTTPException(409, "You're logged in. Use /support/messages so your conversation is saved.")
    reply = respond(body.text, None, db, {})
    return {"text": reply.text, "quick_replies": reply.quick_replies, "links": reply.links}
