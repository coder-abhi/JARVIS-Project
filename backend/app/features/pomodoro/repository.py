from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import Project, ProjectType
from . import models, schemas


def list_history(db: Session, *, user_id: str) -> list[schemas.PomodoroHistoryRead]:
    sessions = db.scalars(
        select(models.PomodoroHistorySession)
        .where(models.PomodoroHistorySession.user_id == user_id)
        .order_by(models.PomodoroHistorySession.completed_at.desc())
    )
    return [_to_read(session) for session in sessions]


def upsert_history(
    db: Session,
    *,
    user_id: str,
    data: schemas.PomodoroHistoryWrite,
) -> schemas.PomodoroHistoryRead:
    session = db.get(models.PomodoroHistorySession, data.id)
    if session is not None and session.user_id != user_id:
        raise PermissionError("Pomodoro session belongs to another user")
    values = {
        "user_id": user_id,
        "mode": data.mode,
        "minutes": data.minutes,
        "started_at": data.startAt,
        "completed_at": data.endAt or data.completedAt,
        "description": data.done or None,
        "focus_rating": data.focus,
        "fixed_project_id": _owned_project_id(
            db,
            user_id=user_id,
            project_id=data.projectId,
            expected_type=ProjectType.fixed,
        ),
        "continuous_project_id": _owned_project_id(
            db,
            user_id=user_id,
            project_id=data.taskId,
            expected_type=ProjectType.continuous,
        ),
        "project_name_snapshot": data.projectName,
        "task_title_snapshot": data.taskTitle,
        "is_manual": data.isManual,
    }
    if session is None:
        session = models.PomodoroHistorySession(id=data.id, **values)
        db.add(session)
    else:
        for field, value in values.items():
            setattr(session, field, value)
    db.commit()
    db.refresh(session)
    return _to_read(session)


def delete_history(db: Session, *, user_id: str, session_id: str) -> bool:
    session = db.get(models.PomodoroHistorySession, session_id)
    if session is None or session.user_id != user_id:
        return False
    db.delete(session)
    db.commit()
    return True


def _to_read(session: models.PomodoroHistorySession) -> schemas.PomodoroHistoryRead:
    return schemas.PomodoroHistoryRead(
        id=session.id,
        completedAt=session.completed_at,
        startAt=session.started_at,
        endAt=session.completed_at,
        minutes=session.minutes,
        mode=session.mode,
        projectId=session.fixed_project_id,
        projectName=session.project_name_snapshot,
        taskId=session.continuous_project_id,
        taskTitle=session.task_title_snapshot,
        done=session.description,
        focus=session.focus_rating,
        isManual=session.is_manual,
        created_at=session.created_at,
    )


def _owned_project_id(
    db: Session,
    *,
    user_id: str,
    project_id: str | None,
    expected_type: ProjectType,
) -> str | None:
    if not project_id:
        return None
    project = db.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise ValueError("Pomodoro project not found")
    if project.type != expected_type:
        raise ValueError(f"Pomodoro project must be {expected_type.value}")
    return project.id
