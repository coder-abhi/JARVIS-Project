from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ... import auth, crud, models, schemas
from ...database import get_db

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("/overview", response_model=schemas.GoalsOverview)
async def goals_overview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.get_goals_overview(db, current_user)


@router.post("", response_model=schemas.GoalRead, status_code=201)
async def create_goal(
    goal: schemas.GoalCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return crud.create_goal(db, goal, current_user)
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
        db_goal = crud.update_goal(db, goal_id, goal, current_user)
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
    return crud.log_goal_entry(db, request, current_user)


@router.put("/tasks/{task_id}/complete", response_model=schemas.CompletedGoalLogRead)
async def complete_goal_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    completion = crud.complete_goal_task(db, task_id, current_user)
    if completion is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return completion


@router.put("/completions/{completion_id}/restore", response_model=schemas.GoalTaskRead)
async def restore_goal_completion(
    completion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    task = crud.restore_goal_completion(db, completion_id, current_user)
    if task is None:
        raise HTTPException(status_code=404, detail="Completion not found")
    return crud._goal_task_read(task)


@router.delete("/completions/{completion_id}", status_code=204)
async def delete_goal_completion(
    completion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not crud.delete_goal_completion(db, completion_id, current_user):
        raise HTTPException(status_code=404, detail="Completion not found")


@router.post("/personality/refresh", response_model=schemas.PersonalityInsightRead)
async def refresh_personality_insight(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.refresh_personality_insight(db, current_user)


@router.get("/next-actions", response_model=list[schemas.GoalNextActionRead])
async def next_goal_actions(
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.suggest_goal_next_actions(db, current_user, force_refresh=refresh)


@router.get("/captain-compass", response_model=schemas.CaptainCompassRead)
async def captain_compass(
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.get_captain_compass(db, current_user, force_refresh=refresh)
