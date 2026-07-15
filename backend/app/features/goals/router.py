from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ... import auth, models, schemas
from ...database import get_db
from . import service

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("/overview", response_model=schemas.GoalsOverview)
async def goals_overview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return service.get_goals_overview(db, current_user)


@router.post("", response_model=schemas.GoalRead, status_code=201)
async def create_goal(
    goal: schemas.GoalCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return service.create_goal(db, goal, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{goal_id}", response_model=schemas.GoalRead)
async def update_goal(
    goal_id: str,
    goal: schemas.GoalUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        db_goal = service.update_goal(db, goal_id, goal, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if db_goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return db_goal


@router.post("/log", response_model=schemas.GoalLogResponse)
async def log_goal_entry(
    request: schemas.GoalLogRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return service.log_goal_entry(db, request, current_user)


@router.put("/tasks/{task_id}/complete", response_model=schemas.CompletedGoalLogRead | None)
async def complete_goal_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return service.complete_goal_task(db, task_id, current_user)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/tasks/{task_id}/breakdown", response_model=schemas.TaskBreakdownRead)
async def breakdown_goal_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        parent, children = service.breakdown_goal_task(db, task_id, current_user)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not children:
        raise HTTPException(status_code=422, detail="This task is already small enough to act on directly.")
    return schemas.TaskBreakdownRead(
        parent=service.goal_task_read(parent, has_children=True),
        children=[service.goal_task_read(child) for child in children],
    )


@router.put("/completions/{completion_id}/restore", response_model=schemas.GoalTaskRead)
async def restore_goal_completion(
    completion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    task = service.restore_goal_completion(db, completion_id, current_user)
    if task is None:
        raise HTTPException(status_code=404, detail="Completion not found")
    return service.goal_task_read(task, has_children=service.task_has_children(db, task.id))


@router.delete("/completions/{completion_id}", status_code=204)
async def delete_goal_completion(
    completion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not service.delete_goal_completion(db, completion_id, current_user):
        raise HTTPException(status_code=404, detail="Completion not found")


@router.post("/personality/refresh", response_model=schemas.PersonalityInsightRead)
async def refresh_personality_insight(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return service.refresh_personality_insight(db, current_user)


@router.get("/next-actions", response_model=list[schemas.GoalNextActionRead])
async def next_goal_actions(
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return service.suggest_goal_next_actions(db, current_user, force_refresh=refresh)


@router.get("/captain-compass", response_model=schemas.CaptainCompassRead)
async def captain_compass(
    refresh: bool = Query(default=False),
    days: int = Query(default=30),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if days not in service.CAPTAIN_COMPASS_CONTEXT_DAYS:
        raise HTTPException(status_code=422, detail="days must be 7, 30, or 90")
    return service.get_captain_compass(
        db,
        current_user,
        force_refresh=refresh,
        context_days=days,
        timezone_offset_minutes=timezone_offset_minutes,
    )


@router.get("/completion-trend", response_model=schemas.GoalCompletionTrendRead)
async def goal_completion_trend(
    days: int = Query(default=30),
    timezone_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if days not in service.CAPTAIN_COMPASS_CONTEXT_DAYS:
        raise HTTPException(status_code=422, detail="days must be 7, 30, or 90")
    return service.get_goal_completion_trend(
        db,
        current_user,
        context_days=days,
        timezone_offset_minutes=timezone_offset_minutes,
    )
