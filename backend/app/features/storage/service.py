import json
from typing import Any

from sqlalchemy.orm import Session

from . import repository


def read_user_document(db: Session, *, user_id: str, key: str) -> dict[str, Any]:
    document = repository.get_document(db, user_id=user_id, key=key)
    if document is None:
        return {"key": key, "data": None, "updated_at": None}
    return {
        "key": document.key,
        "data": json.loads(document.value_json),
        "updated_at": document.updated_at,
    }


def write_user_document(db: Session, *, user_id: str, key: str, data: Any) -> dict[str, Any]:
    document = repository.upsert_document(db, user_id=user_id, key=key, data=data)
    return {
        "key": document.key,
        "data": json.loads(document.value_json),
        "updated_at": document.updated_at,
    }
