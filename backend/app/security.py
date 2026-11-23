"""Password hashing + JWT tokens + the `get_current_user` dependency that protects routes."""

import os
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User

# In production this MUST come from the environment and be long and random.
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-change-me-in-production-0123456789")
ALGORITHM = "HS256"
TOKEN_TTL = timedelta(days=7)

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    # bcrypt adds a random salt and is deliberately slow, which makes brute-forcing hard.
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(UTC) + TOKEN_TTL}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", {"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        user_id = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])["sub"]
    except jwt.PyJWTError:  # bad signature, expired, malformed...
        raise unauthorized from None  # hide the JWT internals from the client
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """For public endpoints that behave slightly differently when you're logged in (e.g. 'can I review this?')."""
    if creds is None:
        return None
    try:
        return db.get(User, jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])["sub"])
    except jwt.PyJWTError:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Admin access required."
        )  # 403: we know who you are, you're just not allowed
    return user
