from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models


def get_goal(db: Session, goal_id: str, user: models.User) -> models.Goal | None:
    return db.scalar(
        select(models.Goal)
        .where(models.Goal.id == goal_id, models.Goal.user_id == user.id)
        .options(selectinload(models.Goal.linked_projects))
    )


def get_user_goals_by_ids(db: Session, goal_ids: list[str], user: models.User) -> list[models.Goal]:
    unique_ids = list(dict.fromkeys(goal_ids))
    if not unique_ids:
        return []
    goals = list(
        db.scalars(
            select(models.Goal)
            .where(models.Goal.user_id == user.id, models.Goal.id.in_(unique_ids))
            .order_by(models.Goal.created_at.asc())
        )
    )
    if len(goals) != len(unique_ids):
        raise ValueError("One or more linked goals were not found")
    return goals


def list_goal_active_tasks(db: Session, user: models.User) -> list[models.Task]:
    """Root tasks that aren't done, plus every descendant of those roots (any status).

    A parent only ever becomes `done` once all of its children are, so a root still open
    guarantees at least one open leaf somewhere in its subtree - completed descendants stay
    listed so the tree view can render them struck through in place.
    """
    query = (
        select(models.Task)
        .join(models.Project)
        .where(models.Project.user_id == user.id)
        .options(selectinload(models.Task.project).selectinload(models.Project.linked_goals))
        .order_by(models.Task.importance_rating.desc(), models.Task.created_at.desc())
    )
    all_tasks = list(db.scalars(query))

    children_by_parent: dict[str | None, list[models.Task]] = {}
    for task in all_tasks:
        children_by_parent.setdefault(task.parent_task_id, []).append(task)

    result: list[models.Task] = []

    def include_subtree(task: models.Task) -> None:
        result.append(task)
        for child in children_by_parent.get(task.id, []):
            include_subtree(child)

    for root in children_by_parent.get(None, []):
        if root.status != models.TaskStatus.done:
            include_subtree(root)

    return result


def task_has_children(db: Session, task_id: str) -> bool:
    return db.scalar(select(models.Task.id).where(models.Task.parent_task_id == task_id).limit(1)) is not None


def list_recent_goal_completions(db: Session, user: models.User, limit: int = 12) -> list[models.CompletedGoalLog]:
    return list(
        db.scalars(
            select(models.CompletedGoalLog)
            .where(models.CompletedGoalLog.user_id == user.id)
            .options(selectinload(models.CompletedGoalLog.task))
            .order_by(models.CompletedGoalLog.created_at.desc())
            .limit(limit)
        )
    )


def list_goal_completions_by_project(
    db: Session,
    project_id: str,
    user: models.User,
) -> list[models.CompletedGoalLog]:
    return list(
        db.scalars(
            select(models.CompletedGoalLog)
            .where(
                models.CompletedGoalLog.user_id == user.id,
                models.CompletedGoalLog.project_id == project_id,
            )
            .options(selectinload(models.CompletedGoalLog.task))
            .order_by(models.CompletedGoalLog.created_at.desc())
        )
    )
