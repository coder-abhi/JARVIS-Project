from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ... import auth, models as root_models
from ...database import get_db
from . import repository, schemas

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=schemas.UserPreferenceRead)
async def get_preferences(
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return repository.read_preferences(db, user_id=current_user.id)


@router.put("", response_model=schemas.UserPreferenceRead)
async def update_preferences(
    preferences: schemas.UserPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return repository.save_preferences(db, user_id=current_user.id, data=preferences)
