from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ... import auth, models
from ...database import get_db
from . import schemas, service

router = APIRouter(prefix="/storage", tags=["storage"])


@router.get("/{key}", response_model=schemas.UserDocumentRead)
async def get_user_document(
    key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return service.read_user_document(db, user_id=current_user.id, key=key)


@router.put("/{key}", response_model=schemas.UserDocumentRead)
async def put_user_document(
    key: str,
    payload: schemas.UserDocumentWrite,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return service.write_user_document(db, user_id=current_user.id, key=key, data=payload.data)
