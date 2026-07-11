from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models


def get_project(db: Session, project_id: str, user: models.User) -> models.Project | None:
    return db.scalar(
        select(models.Project)
        .where(models.Project.id == project_id, models.Project.user_id == user.id)
        .options(selectinload(models.Project.linked_goals))
    )


def list_projects(db: Session, user: models.User) -> list[models.Project]:
    query = (
        select(models.Project)
        .where(models.Project.user_id == user.id)
        .options(selectinload(models.Project.linked_goals))
        .order_by(models.Project.created_at.desc())
    )
    return list(db.scalars(query))


def get_user_projects_by_ids(db: Session, project_ids: list[str], user: models.User) -> list[models.Project]:
    unique_ids = list(dict.fromkeys(project_ids))
    if not unique_ids:
        return []
    projects = list(
        db.scalars(
            select(models.Project)
            .where(models.Project.user_id == user.id, models.Project.id.in_(unique_ids))
            .order_by(models.Project.created_at.asc())
        )
    )
    if len(projects) != len(unique_ids):
        raise ValueError("One or more linked projects were not found")
    return projects


def get_or_create_general_work_project(db: Session, user: models.User) -> models.Project:
    project = db.scalar(
        select(models.Project)
        .where(models.Project.user_id == user.id, models.Project.name == "General Work")
        .options(selectinload(models.Project.linked_goals))
        .order_by(models.Project.created_at.asc())
    )
    if project is not None:
        if not project.description:
            project.description = "General tasks that do not clearly fit another project."
            db.commit()
        return project
    project = models.Project(
        user_id=user.id,
        name="General Work",
        description="General tasks that do not clearly fit another project.",
        type=models.ProjectType.continuous,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project
