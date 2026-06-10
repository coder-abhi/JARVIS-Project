import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import UserDocument
from .schemas import HelpingHandsData, HelpingHandsTransaction


DOCUMENT_KEY = "helping-hands"


def get_helping_hands_data(db: Session, *, user_id: str) -> HelpingHandsData:
    document = _get_document(db, user_id=user_id)
    if document is None:
        return HelpingHandsData()

    try:
        return _normalize_document(json.loads(document.value_json))
    except (json.JSONDecodeError, ValueError, TypeError):
        return HelpingHandsData()


def upsert_transaction(
    db: Session,
    *,
    user_id: str,
    transaction: HelpingHandsTransaction,
) -> HelpingHandsData:
    data = get_helping_hands_data(db, user_id=user_id)
    existing_index = next(
        (index for index, current in enumerate(data.transactions) if current.id == transaction.id),
        None,
    )
    original_created_at = (
        data.transactions[existing_index].createdAt
        if existing_index is not None
        else ""
    )
    item = transaction.model_copy(
        update={
            "createdAt": (
                transaction.createdAt
                or original_created_at
                or datetime.now(timezone.utc).isoformat()
            )
        }
    )
    if existing_index is None:
        data.transactions.append(item)
    else:
        data.transactions[existing_index] = item
    return _save_data(db, user_id=user_id, data=data)


def delete_transaction(db: Session, *, user_id: str, transaction_id: str) -> HelpingHandsData:
    data = get_helping_hands_data(db, user_id=user_id)
    remaining = [item for item in data.transactions if item.id != transaction_id]
    if len(remaining) == len(data.transactions):
        raise ValueError("Transaction not found")
    data.transactions = remaining
    return _save_data(db, user_id=user_id, data=data)


def _save_data(db: Session, *, user_id: str, data: HelpingHandsData) -> HelpingHandsData:
    document = _get_document(db, user_id=user_id)
    value_json = data.model_dump_json()
    if document is None:
        document = UserDocument(user_id=user_id, key=DOCUMENT_KEY, value_json=value_json)
        db.add(document)
    else:
        document.value_json = value_json
    db.commit()
    return data


def _get_document(db: Session, *, user_id: str) -> UserDocument | None:
    return db.scalar(
        select(UserDocument).where(
            UserDocument.user_id == user_id,
            UserDocument.key == DOCUMENT_KEY,
        )
    )


def _normalize_document(raw: object) -> HelpingHandsData:
    if not isinstance(raw, dict):
        return HelpingHandsData()
    if raw.get("version") == 2:
        return HelpingHandsData.model_validate(raw)

    members = {
        str(item.get("id")): str(item.get("name") or "").strip()
        for item in raw.get("members", [])
        if isinstance(item, dict) and item.get("id") and item.get("name")
    }
    transactions: list[HelpingHandsTransaction] = []
    for item in raw.get("loans", []):
        if not isinstance(item, dict) or item.get("source") != "cash":
            continue
        member = members.get(str(item.get("memberId")), "")
        if member:
            transactions.append(
                HelpingHandsTransaction(
                    id=f"legacy-loan-{item.get('id')}",
                    member=member,
                    direction="sent",
                    amount=item.get("amount", 0),
                    date=str(item.get("issuedOn") or ""),
                    note=str(item.get("note") or ""),
                )
            )
    for item in raw.get("transactions", []):
        if not isinstance(item, dict):
            continue
        member = members.get(str(item.get("memberId")), "")
        transaction_type = item.get("type")
        if not member or transaction_type not in {
            "contribution",
            "principal_payment",
            "interest_payment",
        }:
            continue
        transactions.append(
            HelpingHandsTransaction(
                id=f"legacy-payment-{item.get('id')}",
                member=member,
                direction="received",
                amount=item.get("amount", 0),
                date=str(item.get("date") or ""),
                note=str(item.get("note") or ""),
            )
        )
    return HelpingHandsData(transactions=transactions)
