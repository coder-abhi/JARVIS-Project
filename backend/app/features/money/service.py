import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import UserDocument
from . import repository, schemas

LEGACY_DOCUMENT_KEY = "wealth-command"


def get_wealth_data(db: Session, *, user_id: str) -> schemas.WealthData:
    if not repository.has_wealth_data(db, user_id=user_id):
        legacy = _get_legacy_document(db, user_id=user_id)
        if legacy is not None:
            data = schemas.WealthData.model_validate(_normalize_legacy_data(json.loads(legacy.value_json)))
            repository.replace_wealth_data(db, user_id=user_id, data=data)
            db.delete(legacy)
            db.commit()
        else:
            repository.replace_wealth_data(db, user_id=user_id, data=schemas.WealthData())
    return repository.read_wealth_data(db, user_id=user_id)


def save_wealth_data(db: Session, *, user_id: str, data: schemas.WealthData) -> schemas.WealthData:
    saved = repository.replace_wealth_data(db, user_id=user_id, data=data)
    legacy = _get_legacy_document(db, user_id=user_id)
    if legacy is not None:
        db.delete(legacy)
        db.commit()
    return saved


def save_resource(
    db: Session,
    *,
    user_id: str,
    resource: str,
    data,
    create_only: bool,
) -> schemas.WealthData:
    return repository.upsert_resource(
        db,
        user_id=user_id,
        resource=resource,
        data=data,
        create_only=create_only,
    )


def _get_legacy_document(db: Session, *, user_id: str) -> UserDocument | None:
    return db.scalar(
        select(UserDocument).where(
            UserDocument.user_id == user_id,
            UserDocument.key == LEGACY_DOCUMENT_KEY,
        )
    )


def _normalize_legacy_data(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    cards = data.get("cards") if isinstance(data.get("cards"), list) else []
    return {
        **data,
        "cards": [
            {
                **{key: item for key, item in card.items() if key != "currentBalance"},
                "generatedBill": card.get("generatedBill", 0),
                "currentBill": card.get("currentBill", card.get("currentBalance", 0)),
            }
            for card in cards
            if isinstance(card, dict)
        ],
    }
