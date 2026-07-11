from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models, schemas
from ...shared.utils import as_aware, clean_text
from ..goals.repository import get_user_goals_by_ids
from .repository import get_project, list_projects

__all__ = ["create_project", "get_project", "list_project_summaries", "list_projects", "update_project"]


def create_project(db: Session, project: schemas.ProjectCreate, user: models.User) -> models.Project:
    project_data = project.model_dump(exclude={"goal_id", "linked_goal_ids"})
    linked_goals = get_user_goals_by_ids(db, project.linked_goal_ids, user)
    project_data["description"] = clean_text(project_data.get("description"))
    db_project = models.Project(
        **project_data,
        user_id=user.id,
        goal_id=linked_goals[0].id if linked_goals else None,
        linked_goals=linked_goals,
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


def update_project(
    db: Session,
    project_id: str,
    project: schemas.ProjectUpdate,
    user: models.User,
) -> models.Project | None:
    db_project = get_project(db, project_id, user)
    if db_project is None:
        return None

    changes = project.model_dump(exclude_unset=True, exclude={"goal_id", "linked_goal_ids"})
    if "description" in changes:
        changes["description"] = clean_text(changes["description"])
    for key, value in changes.items():
        setattr(db_project, key, value)

    if "linked_goal_ids" in project.model_fields_set or "goal_id" in project.model_fields_set:
        linked_goals = get_user_goals_by_ids(db, project.linked_goal_ids or [], user)
        db_project.linked_goals = linked_goals
        db_project.goal_id = linked_goals[0].id if linked_goals else None

    db.commit()
    db.refresh(db_project)
    return db_project


def list_project_summaries(db: Session, user: models.User) -> list[schemas.ProjectSummary]:
    query = (
        select(models.Project)
        .where(models.Project.user_id == user.id)
        .options(
            selectinload(models.Project.tasks),
            selectinload(models.Project.pomodoro_sessions),
            selectinload(models.Project.linked_goals),
        )
        .order_by(models.Project.created_at.desc())
    )
    projects = list(db.scalars(query))
    now = datetime.now(timezone.utc)
    summaries: list[schemas.ProjectSummary] = []

    for project in projects:
        tasks = project.tasks
        session_hours = sum(session.minutes for session in project.pomodoro_sessions) / 60
        active_deadlines = [task.deadline for task in tasks if task.deadline is not None and task.status != models.TaskStatus.done]
        overdue_tasks = [
            task
            for task in tasks
            if task.deadline is not None
            and task.status != models.TaskStatus.done
            and as_aware(task.deadline) < now
        ]
        completed_hours = sum(
            task.eta_hours if task.status == models.TaskStatus.done else min(task.time_spent_hours, task.eta_hours)
            for task in tasks
        )
        remaining_hours = sum(
            0 if task.status == models.TaskStatus.done else max(task.eta_hours - task.time_spent_hours, 0)
            for task in tasks
        )

        summaries.append(
            schemas.ProjectSummary(
                id=project.id,
                name=project.name,
                description=project.description,
                type=project.type,
                goal_id=project.linked_goals[0].id if len(project.linked_goals) == 1 else None,
                linked_goals=project.linked_goals,
                created_at=project.created_at,
                total_tasks=len(tasks),
                completed_tasks=sum(task.status == models.TaskStatus.done for task in tasks),
                in_progress_tasks=sum(task.status == models.TaskStatus.in_progress for task in tasks),
                overdue_tasks=len(overdue_tasks),
                eta_hours=sum(task.eta_hours for task in tasks),
                time_spent_hours=sum(task.time_spent_hours for task in tasks) + session_hours,
                completed_hours=completed_hours,
                remaining_hours=remaining_hours,
                next_deadline=min(active_deadlines, key=as_aware) if active_deadlines else None,
            )
        )

    return summaries
