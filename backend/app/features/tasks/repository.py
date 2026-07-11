from sqlalchemy import select
from sqlalchemy.orm import Session

from ... import models


def get_user_task(db: Session, task_id: str, user: models.User) -> models.Task | None:
    return db.scalar(
        select(models.Task)
        .join(models.Project)
        .where(models.Task.id == task_id, models.Project.user_id == user.id)
    )


def list_tasks_by_project(db: Session, project_id: str) -> list[models.Task]:
    query = select(models.Task).where(models.Task.project_id == project_id).order_by(models.Task.created_at.desc())
    return list(db.scalars(query))
