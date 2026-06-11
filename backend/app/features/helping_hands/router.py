from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, models as root_models
from ...database import get_db
from . import schemas, service


router = APIRouter(prefix="/helping-hands", tags=["helping-hands"])


@router.get("", response_model=schemas.HelpingHandsData)
async def get_helping_hands_data(
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return service.get_helping_hands_data(db, user_id=current_user.id)


@router.put("/start-month", response_model=schemas.HelpingHandsData)
async def update_helping_hands_start_month(
    payload: schemas.HelpingHandsStartMonth,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return service.update_start_month(
        db,
        user_id=current_user.id,
        start_month=payload.startMonth,
    )


@router.put("/transactions/{transaction_id}", response_model=schemas.HelpingHandsData)
async def upsert_helping_hands_transaction(
    transaction_id: str,
    transaction: schemas.HelpingHandsTransaction,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    if transaction_id != transaction.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path id and body id must match",
        )
    return service.upsert_transaction(
        db,
        user_id=current_user.id,
        transaction=transaction,
    )


@router.delete("/transactions/{transaction_id}", response_model=schemas.HelpingHandsData)
async def delete_helping_hands_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    try:
        return service.delete_transaction(
            db,
            user_id=current_user.id,
            transaction_id=transaction_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
