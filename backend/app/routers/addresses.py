"""Address book: many addresses per user, exactly one marked default.
Every endpoint returns the user's FULL updated list, so the frontend just replaces its state (no refetching,
no guessing what changed)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Address, User
from ..schemas import AddressIn, AddressOut
from ..security import get_current_user

router = APIRouter(prefix="/addresses", tags=["addresses"])
MAX_ADDRESSES = 10


def _own(address_id: str, user: User, db: Session) -> Address:
    addr = db.get(Address, address_id)
    if not addr or addr.user_id != user.id:  # 404 for other people's ids too: don't reveal they exist
        raise HTTPException(404, "Address not found")
    return addr


def _make_default(user: User, chosen: Address) -> None:
    for a in user.addresses:
        a.is_default = a.id == chosen.id


def _finish(user: User, db: Session) -> list[Address]:
    db.commit()
    db.refresh(user)  # reload the relationship so the list comes back in the right order
    return user.addresses


@router.get("", response_model=list[AddressOut])
def list_addresses(user: User = Depends(get_current_user)):
    return user.addresses


@router.post("", response_model=list[AddressOut], status_code=201)
def add_address(body: AddressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if len(user.addresses) >= MAX_ADDRESSES:
        raise HTTPException(409, f"You can save up to {MAX_ADDRESSES} addresses. Delete one to add another.")
    addr = Address(user_id=user.id, **body.model_dump(exclude={"is_default"}))
    user.addresses.append(addr)
    db.flush()
    if body.is_default or len(user.addresses) == 1:  # the very first address is always the default
        _make_default(user, addr)
    return _finish(user, db)


@router.put("/{address_id}", response_model=list[AddressOut])
def edit_address(address_id: str, body: AddressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    addr = _own(address_id, user, db)
    for field, value in body.model_dump(exclude={"is_default"}).items():
        setattr(addr, field, value)
    if body.is_default:  # a default can't be "un-defaulted" directly; pick another address as default instead
        _make_default(user, addr)
    return _finish(user, db)


@router.post("/{address_id}/default", response_model=list[AddressOut])
def set_default(address_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _make_default(user, _own(address_id, user, db))
    return _finish(user, db)


@router.delete("/{address_id}", response_model=list[AddressOut])
def delete_address(address_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    addr = _own(address_id, user, db)
    was_default = addr.is_default
    user.addresses.remove(addr)  # delete-orphan cascade deletes the row
    db.flush()
    if was_default and user.addresses:  # never leave the user without a default
        _make_default(user, user.addresses[0])
    return _finish(user, db)
