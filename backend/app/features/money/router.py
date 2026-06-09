from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ... import auth, models as root_models
from ...database import get_db
from . import schemas, service

router = APIRouter(prefix="/money", tags=["money"])


@router.get("", response_model=schemas.WealthData)
async def get_wealth_data(
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return service.get_wealth_data(db, user_id=current_user.id)


@router.put("", response_model=schemas.WealthData)
async def put_wealth_data(
    data: schemas.WealthData,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return service.save_wealth_data(db, user_id=current_user.id, data=data)
