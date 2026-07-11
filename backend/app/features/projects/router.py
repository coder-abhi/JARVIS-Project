from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, models, schemas
from ...database import get_db
from ..goals.repository import list_goal_completions_by_project
from ..pomodoro import service as pomodoro_service
from ..tasks.repository import list_tasks_by_project
from . import service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[schemas.ProjectRead])
async def list_projects(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return service.list_projects(db, current_user)


@router.get("/summary", response_model=list[schemas.ProjectSummary])
async def list_project_summaries(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return service.list_project_summaries(db, current_user)


@router.post("", response_model=schemas.ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    project: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return service.create_project(db, project, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.put("/{project_id}", response_model=schemas.ProjectRead)
async def update_project(
    project_id: str,
    project: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        db_project = service.update_project(db, project_id, project, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return db_project


@router.get("/{project_id}/tasks", response_model=list[schemas.TaskRead])
async def list_project_tasks(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if service.get_project(db, project_id, current_user) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return list_tasks_by_project(db, project_id)


@router.get("/{project_id}/pomodoro-sessions", response_model=list[schemas.PomodoroSessionLogRead])
async def list_project_pomodoro_sessions(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if service.get_project(db, project_id, current_user) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return pomodoro_service.list_pomodoro_sessions_by_project(db, project_id, current_user)


@router.get("/{project_id}/completions", response_model=list[schemas.CompletedGoalLogRead])
async def list_project_completions(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if service.get_project(db, project_id, current_user) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return list_goal_completions_by_project(db, project_id, current_user)


@router.put("/pomodoro-sessions/{session_id}", response_model=schemas.PomodoroSessionLogRead)
async def upsert_project_pomodoro_session(
    session_id: str,
    session_log: schemas.PomodoroSessionLogCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if session_id != session_log.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session id mismatch")
    db_log = pomodoro_service.upsert_pomodoro_session_log(db, session_log, current_user)
    if db_log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return db_log


@router.delete("/pomodoro-sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_pomodoro_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    pomodoro_service.delete_pomodoro_session_log(db, session_id, current_user)
