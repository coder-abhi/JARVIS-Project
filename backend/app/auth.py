import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models, schemas
from .database import get_db


security = HTTPBearer(auto_error=False)
password_iterations = 210_000


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), password_iterations)
    return f"pbkdf2_sha256${password_iterations}${salt}${base64.urlsafe_b64encode(digest).decode('ascii')}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, stored_digest = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations))
        return hmac.compare_digest(base64.urlsafe_b64encode(digest).decode("ascii"), stored_digest)
    except (ValueError, TypeError):
        return False


def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    username = normalize_username(user.username)
    existing_user = db.scalar(select(models.User).where(models.User.username == username))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already taken")

    db_user = models.User(username=username, password_hash=hash_password(user.password))
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def authenticate_user(db: Session, username: str, password: str) -> models.User | None:
    db_user = db.scalar(select(models.User).where(models.User.username == normalize_username(username)))
    if db_user is None or not verify_password(password, db_user.password_hash):
        return None
    return db_user


def create_access_token(user_id: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(days=14)
    payload = {"sub": user_id, "exp": int(expires_at.timestamp())}
    payload_part = _urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _sign(payload_part)
    return f"{payload_part}.{signature}"


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _auth_error()

    user_id = verify_access_token(credentials.credentials)
    if user_id is None:
        raise _auth_error()

    db_user = db.get(models.User, user_id)
    if db_user is None:
        raise _auth_error()

    return db_user


def verify_access_token(token: str) -> str | None:
    try:
        payload_part, signature = token.split(".", 1)
    except ValueError:
        return None

    if not hmac.compare_digest(_sign(payload_part), signature):
        return None

    try:
        payload = json.loads(_urlsafe_b64decode(payload_part))
        expires_at = int(payload["exp"])
        user_id = str(payload["sub"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None

    if datetime.now(timezone.utc).timestamp() >= expires_at:
        return None
    return user_id


def _sign(value: str) -> str:
    secret = os.getenv("AUTH_SECRET_KEY", "local-dev-auth-secret")
    digest = hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
    return _urlsafe_b64encode(digest)


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}").decode("utf-8")


def _auth_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Please log in to continue",
        headers={"WWW-Authenticate": "Bearer"},
    )
