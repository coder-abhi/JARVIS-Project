from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models, schemas
from .repository import get_user_task, list_tasks_by_project

__all__ = [
    "create_task",
    "create_task_completion_log",
    "delete_task",
    "list_tasks_by_project",
    "remove_task_completion_logs",
    "task_linked_goals",
    "task_progress_delta",
    "update_task",
]


def create_task(db: Session, task: schemas.TaskCreate) -> models.Task:
    task_data = task.model_dump()
    if task_data["status"] == models.TaskStatus.todo:
        task_data["start_date"] = None
    elif task_data["status"] == models.TaskStatus.in_progress and task_data["start_date"] is None:
        task_data["start_date"] = datetime.now(timezone.utc)
    if task_data["status"] == models.TaskStatus.done:
        task_data["completed_at"] = datetime.now(timezone.utc)
        task_data["completion_percentage"] = 100

    db_task = models.Task(**task_data)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


def update_task(db: Session, task_id: str, task: schemas.TaskUpdate, user: models.User) -> models.Task | None:
    db_task = get_user_task(db, task_id, user)
    if db_task is None:
        return None

    changes = task.model_dump(exclude_unset=True)
    previous_status = db_task.status
    next_status = changes.get("status", db_task.status)

    if next_status == models.TaskStatus.todo:
        changes["start_date"] = None
    elif next_status == models.TaskStatus.in_progress and "start_date" not in changes and db_task.start_date is None:
        changes["start_date"] = datetime.now(timezone.utc)
    if next_status == models.TaskStatus.done and db_task.status != models.TaskStatus.done:
        changes["completed_at"] = datetime.now(timezone.utc)
        changes["completion_percentage"] = 100
    elif next_status != models.TaskStatus.done:
        changes["completed_at"] = None
        if previous_status == models.TaskStatus.done and "completion_percentage" not in changes:
            changes["completion_percentage"] = 0

    for key, value in changes.items():
        setattr(db_task, key, value)

    if previous_status != models.TaskStatus.done and next_status == models.TaskStatus.done:
        create_task_completion_log(db, db_task, user)
    elif previous_status == models.TaskStatus.done and next_status != models.TaskStatus.done:
        remove_task_completion_logs(db, db_task, user)
    elif next_status == models.TaskStatus.done and "title" in changes:
        for completion in db.scalars(
            select(models.CompletedGoalLog).where(
                models.CompletedGoalLog.user_id == user.id,
                models.CompletedGoalLog.task_id == db_task.id,
            )
        ):
            completion.title = db_task.title

    db.commit()
    db.refresh(db_task)
    return db_task


def delete_task(db: Session, task_id: str, user: models.User) -> bool:
    db_task = get_user_task(db, task_id, user)
    if db_task is None:
        return False

    completion_logs = list(
        db.scalars(
            select(models.CompletedGoalLog).where(
                models.CompletedGoalLog.user_id == user.id,
                models.CompletedGoalLog.task_id == task_id,
            )
        )
    )
    for completion in completion_logs:
        if completion.goal and completion.goal.measurable:
            completion.goal.current_value = max(
                completion.goal.current_value - task_progress_delta(db_task, completion.goal),
                0,
            )
        db.delete(completion)
    db.delete(db_task)
    db.commit()
    return True


def create_task_completion_log(
    db: Session,
    task: models.Task,
    user: models.User,
) -> models.CompletedGoalLog:
    linked_goals = task_linked_goals(task)
    for goal in linked_goals:
        if goal.measurable:
            goal.current_value = min(goal.current_value + task_progress_delta(task, goal), goal.target_value or 0)
    logged_goal = linked_goals[0] if len(linked_goals) == 1 else None
    goal_label = ", ".join(goal.title for goal in linked_goals)[:80] or task.project.name[:80]
    completion = models.CompletedGoalLog(
        user_id=user.id,
        goal_id=logged_goal.id if logged_goal else None,
        project_id=task.project_id,
        task_id=task.id,
        title=task.title,
        goal_label=goal_label[:80],
    )
    completion.task = task
    db.add(completion)
    return completion


def remove_task_completion_logs(
    db: Session,
    task: models.Task,
    user: models.User,
) -> None:
    completions = list(
        db.scalars(
            select(models.CompletedGoalLog)
            .where(
                models.CompletedGoalLog.user_id == user.id,
                models.CompletedGoalLog.task_id == task.id,
            )
            .options(selectinload(models.CompletedGoalLog.goal))
        )
    )
    for completion in completions:
        if completion.goal and completion.goal.measurable:
            completion.goal.current_value = max(
                completion.goal.current_value - task_progress_delta(task, completion.goal),
                0,
            )
        db.delete(completion)


def task_linked_goals(task: models.Task) -> list[models.Goal]:
    if task.project is None:
        return []
    return task.project.linked_goals


def task_progress_delta(task: models.Task, goal: models.Goal) -> float:
    if goal.unit and "hour" in goal.unit.lower():
        return task.eta_hours
    return 1
