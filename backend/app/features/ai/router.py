from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ... import auth, models as root_models
from ...database import get_db
from . import schemas, service

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
async def ai_status():
    return service.ai_status()


@router.get("/costs", response_model=schemas.AiCostSummary)
async def ai_costs(
    days: int = Query(default=30, ge=0, le=3650),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return service.get_cost_summary(
        db,
        user_id=current_user.id,
        days=days,
        timezone_offset_minutes=timezone_offset_minutes,
    )
