from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, models as root_models
from ...database import get_db
from . import repository, schemas

router = APIRouter(prefix="/pomodoro", tags=["pomodoro"])


@router.get("/status")
async def pomodoro_status():
    return {
        "status": "ok",
        "storage": "Timer state is kept in the desktop client; completed focus logs are persisted through project session endpoints.",
    }


@router.get("/sessions", response_model=list[schemas.PomodoroHistoryRead])
async def list_pomodoro_sessions(
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return repository.list_history(db, user_id=current_user.id)


@router.post("/sessions", response_model=schemas.PomodoroHistoryRead, status_code=status.HTTP_201_CREATED)
async def create_pomodoro_session(
    session: schemas.PomodoroHistoryWrite,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    try:
        return repository.upsert_history(db, user_id=current_user.id, data=session)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.put("/sessions/{session_id}", response_model=schemas.PomodoroHistoryRead)
async def update_pomodoro_session(
    session_id: str,
    session: schemas.PomodoroHistoryWrite,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    if session_id != session.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session id mismatch")
    try:
        return repository.upsert_history(db, user_id=current_user.id, data=session)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pomodoro_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    if not repository.delete_history(db, user_id=current_user.id, session_id=session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pomodoro session not found")
