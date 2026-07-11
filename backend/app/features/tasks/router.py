from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, models, schemas
from ...database import get_db
from ..pomodoro import service as pomodoro_service
from ..projects.repository import get_project
from . import service

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=schemas.TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(
    task: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if get_project(db, task.project_id, current_user) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return service.create_task(db, task)


@router.post("/pomodoro-assignment", response_model=schemas.PomodoroAssignmentRead)
async def match_pomodoro_assignment(
    request: schemas.PomodoroAssignmentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return pomodoro_service.match_pomodoro_assignment(db, request, current_user)


@router.put("/{task_id}", response_model=schemas.TaskRead)
async def update_task(
    task_id: str,
    task: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = service.update_task(db, task_id, task, current_user)
    if db_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return db_task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not service.delete_task(db, task_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
