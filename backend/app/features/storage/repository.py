import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import UserDocument


def get_document(db: Session, *, user_id: str, key: str) -> UserDocument | None:
    return db.scalar(
        select(UserDocument).where(
            UserDocument.user_id == user_id,
            UserDocument.key == key,
        )
    )


def upsert_document(db: Session, *, user_id: str, key: str, data: Any) -> UserDocument:
    value_json = json.dumps(data, ensure_ascii=True, separators=(",", ":"))
    document = get_document(db, user_id=user_id, key=key)
    if document is None:
        document = UserDocument(user_id=user_id, key=key, value_json=value_json)
        db.add(document)
    else:
        document.value_json = value_json

    db.commit()
    db.refresh(document)
    return document
