from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models, schemas
from ...prompts import POMODORO_ASSIGNMENT_SYSTEM_PROMPT, POMODORO_ASSIGNMENT_USER_PROMPT
from ...shared.utils import as_float, canonical_json, clean_text
from ..ai import service as ai_service
from ..goals.service import goal_context
from ..projects.repository import get_project

__all__ = [
    "delete_pomodoro_session_log",
    "list_pomodoro_sessions_by_project",
    "match_pomodoro_assignment",
    "resolve_pomodoro_assignment",
    "upsert_pomodoro_session_log",
]


def list_pomodoro_sessions_by_project(db: Session, project_id: str, user: models.User) -> list[models.PomodoroSessionLog]:
    query = (
        select(models.PomodoroSessionLog)
        .join(models.Project)
        .where(models.PomodoroSessionLog.project_id == project_id, models.Project.user_id == user.id)
        .order_by(models.PomodoroSessionLog.completed_at.desc())
    )
    return list(db.scalars(query))


def upsert_pomodoro_session_log(
    db: Session,
    session_log: schemas.PomodoroSessionLogCreate,
    user: models.User,
) -> models.PomodoroSessionLog | None:
    if get_project(db, session_log.project_id, user) is None:
        return None

    db_log = db.scalar(
        select(models.PomodoroSessionLog).where(
            models.PomodoroSessionLog.id == session_log.id,
            models.PomodoroSessionLog.user_id == user.id,
        )
    )
    changes = session_log.model_dump()
    changes["description"] = (changes.get("description") or "").strip() or None

    if db_log is None:
        db_log = models.PomodoroSessionLog(**changes, user_id=user.id)
        db.add(db_log)
    else:
        for key, value in changes.items():
            setattr(db_log, key, value)

    db.commit()
    db.refresh(db_log)
    return db_log


def delete_pomodoro_session_log(db: Session, session_id: str, user: models.User) -> bool:
    db_log = db.scalar(
        select(models.PomodoroSessionLog).where(
            models.PomodoroSessionLog.id == session_id,
            models.PomodoroSessionLog.user_id == user.id,
        )
    )
    if db_log is None:
        return False

    db.delete(db_log)
    db.commit()
    return True


def match_pomodoro_assignment(db: Session, request: schemas.PomodoroAssignmentRequest, user: models.User) -> schemas.PomodoroAssignmentRead:
    note = request.note.strip()
    if not note:
        return schemas.PomodoroAssignmentRead(assigned=False, confidence=0, reason="No session note provided.")

    query = (
        select(models.Project)
        .where(models.Project.user_id == user.id)
        .options(selectinload(models.Project.tasks), selectinload(models.Project.linked_goals))
        .order_by(models.Project.created_at.desc())
    )
    if request.project_ids:
        query = query.where(models.Project.id.in_(request.project_ids))
    projects = list(db.scalars(query))
    candidates = [
        {
            "project_id": project.id,
            "project_name": project.name,
            "project_description": project.description,
            "project_type": project.type.value,
            "goal": goal_context(project.parent_goal) if project.parent_goal else None,
            "tasks": [
                {
                    "task_id": task.id,
                    "title": task.title,
                    "description": task.description,
                    "status": task.status.value,
                    "priority": task.priority.value,
                }
                for task in project.tasks
                if task.status != models.TaskStatus.done
            ],
        }
        for project in projects
    ]
    candidates = [project for project in candidates if project["tasks"]]
    if not candidates:
        return schemas.PomodoroAssignmentRead(assigned=False, confidence=0, reason="No active candidate tasks.")

    data = resolve_pomodoro_assignment(note=note, candidates=candidates, user_id=user.id, usage_db=db)
    confidence = as_float(data.get("confidence"))
    project_id = clean_text(data.get("project_id"))
    task_id = clean_text(data.get("task_id"))
    valid_task_ids = {
        task["task_id"]: project["project_id"]
        for project in candidates
        for task in project["tasks"]
    }

    if data.get("assigned") is not True or confidence < 0.78:
        return schemas.PomodoroAssignmentRead(
            assigned=False,
            confidence=confidence,
            reason=clean_text(data.get("reason")) or "The model was not confident enough.",
        )
    if task_id not in valid_task_ids or valid_task_ids[task_id] != project_id:
        return schemas.PomodoroAssignmentRead(
            assigned=False,
            confidence=confidence,
            reason="The model returned an invalid project/task pair.",
        )

    return schemas.PomodoroAssignmentRead(
        assigned=True,
        confidence=confidence,
        project_id=project_id,
        task_id=task_id,
        reason=clean_text(data.get("reason")),
    )


def resolve_pomodoro_assignment(
    note: str,
    candidates: list[dict],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict:
    prompt = f"{POMODORO_ASSIGNMENT_USER_PROMPT} Context: {canonical_json({'note': note, 'candidates': candidates})}"
    return ai_service.call_ai_json(
        POMODORO_ASSIGNMENT_SYSTEM_PROMPT,
        prompt,
        max_tokens=700,
        feature="pomodoro_assignment",
        user_id=user_id,
        usage_db=usage_db,
    )
