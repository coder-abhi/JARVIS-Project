import json
import logging
import os
from datetime import datetime, timedelta, timezone
from time import perf_counter

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import models, schemas
from .features.ai import service as ai_service
from .prompts import (
    BOOK_METADATA_SYSTEM_PROMPT,
    BOOK_METADATA_USER_PROMPT,
    BOOK_RECOMMENDATIONS_SYSTEM_PROMPT,
    BOOK_RECOMMENDATIONS_USER_PROMPT,
    GOAL_LOG_SYSTEM_PROMPT,
    GOAL_LOG_USER_PROMPT,
    GOAL_NEXT_ACTIONS_SYSTEM_PROMPT,
    GOAL_NEXT_ACTIONS_USER_PROMPT,
    OWNED_BOOK_NEXT_READ_SYSTEM_PROMPT,
    OWNED_BOOK_NEXT_READ_USER_PROMPT,
    PERSONALITY_INSIGHT_SYSTEM_PROMPT,
    PERSONALITY_INSIGHT_USER_PROMPT,
    POMODORO_ASSIGNMENT_SYSTEM_PROMPT,
    POMODORO_ASSIGNMENT_USER_PROMPT,
)

try:
    from openai import OpenAI, OpenAIError
except ImportError:  # pragma: no cover - depends on local environment setup
    OpenAI = None
    OpenAIError = Exception


logger = logging.getLogger(__name__)


def create_project(db: Session, project: schemas.ProjectCreate, user: models.User) -> models.Project:
    db_project = models.Project(**project.model_dump(), user_id=user.id)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


def list_projects(db: Session, user: models.User) -> list[models.Project]:
    return list(db.scalars(select(models.Project).where(models.Project.user_id == user.id).order_by(models.Project.created_at.desc())))


def list_project_summaries(db: Session, user: models.User) -> list[schemas.ProjectSummary]:
    query = (
        select(models.Project)
        .where(models.Project.user_id == user.id)
        .options(selectinload(models.Project.tasks), selectinload(models.Project.pomodoro_sessions))
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
            and _as_aware(task.deadline) < now
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
                type=project.type,
                created_at=project.created_at,
                total_tasks=len(tasks),
                completed_tasks=sum(task.status == models.TaskStatus.done for task in tasks),
                in_progress_tasks=sum(task.status == models.TaskStatus.in_progress for task in tasks),
                overdue_tasks=len(overdue_tasks),
                eta_hours=sum(task.eta_hours for task in tasks),
                time_spent_hours=sum(task.time_spent_hours for task in tasks) + session_hours,
                completed_hours=completed_hours,
                remaining_hours=remaining_hours,
                next_deadline=min(active_deadlines, key=_as_aware) if active_deadlines else None,
            )
        )

    return summaries


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def get_project(db: Session, project_id: str, user: models.User) -> models.Project | None:
    return db.scalar(select(models.Project).where(models.Project.id == project_id, models.Project.user_id == user.id))


def create_task(db: Session, task: schemas.TaskCreate) -> models.Task:
    task_data = task.model_dump()
    if task_data["status"] == models.TaskStatus.todo:
        task_data["start_date"] = None
    elif task_data["status"] == models.TaskStatus.in_progress and task_data["start_date"] is None:
        task_data["start_date"] = datetime.now(timezone.utc)

    db_task = models.Task(**task_data)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


def list_tasks_by_project(db: Session, project_id: str) -> list[models.Task]:
    query = select(models.Task).where(models.Task.project_id == project_id).order_by(models.Task.created_at.desc())
    return list(db.scalars(query))


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
        .options(selectinload(models.Project.tasks))
        .order_by(models.Project.created_at.desc())
    )
    if request.project_ids:
        query = query.where(models.Project.id.in_(request.project_ids))
    projects = list(db.scalars(query))
    candidates = [
        {
            "project_id": project.id,
            "project_name": project.name,
            "project_type": project.type.value,
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
    confidence = _as_float(data.get("confidence"))
    project_id = _clean_text(data.get("project_id"))
    task_id = _clean_text(data.get("task_id"))
    valid_task_ids = {
        task["task_id"]: project["project_id"]
        for project in candidates
        for task in project["tasks"]
    }

    if data.get("assigned") is not True or confidence < 0.78:
        return schemas.PomodoroAssignmentRead(
            assigned=False,
            confidence=confidence,
            reason=_clean_text(data.get("reason")) or "The model was not confident enough.",
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
        reason=_clean_text(data.get("reason")),
    )


def update_task(db: Session, task_id: str, task: schemas.TaskUpdate, user: models.User) -> models.Task | None:
    db_task = db.scalar(
        select(models.Task)
        .join(models.Project)
        .where(models.Task.id == task_id, models.Project.user_id == user.id)
    )
    if db_task is None:
        return None

    changes = task.model_dump(exclude_unset=True)
    next_status = changes.get("status", db_task.status)

    if next_status == models.TaskStatus.todo:
        changes["start_date"] = None
    elif next_status == models.TaskStatus.in_progress and "start_date" not in changes and db_task.start_date is None:
        changes["start_date"] = datetime.now(timezone.utc)

    for key, value in changes.items():
        setattr(db_task, key, value)

    db.commit()
    db.refresh(db_task)
    return db_task


GOAL_CATEGORY_LABELS = {
    models.GoalCategory.monthly: "Monthly Goals",
    models.GoalCategory.quarterly: "Quarterly Goals",
    models.GoalCategory.yearly: "Yearly Goals",
    models.GoalCategory.five_year: "5-Year Goals",
}

DEFAULT_GOALS = {
    models.GoalCategory.monthly: {
        "title": "Complete 20 study hours this month",
        "target_value": 20,
        "current_value": 0,
        "unit": "study hours",
    },
    models.GoalCategory.quarterly: {
        "title": "Ship one meaningful project improvement this quarter",
        "target_value": None,
        "current_value": 0,
        "unit": None,
    },
    models.GoalCategory.yearly: {
        "title": "Build a durable personal execution system this year",
        "target_value": None,
        "current_value": 0,
        "unit": None,
    },
    models.GoalCategory.five_year: {
        "title": "Grow into a deeply capable, independent builder over five years",
        "target_value": None,
        "current_value": 0,
        "unit": None,
    },
}


def ensure_default_goals(db: Session, user: models.User) -> list[models.Goal]:
    existing = list(
        db.scalars(
            select(models.Goal)
            .where(models.Goal.user_id == user.id)
            .order_by(models.Goal.created_at.asc())
        )
    )
    existing_categories = {goal.category for goal in existing}

    for category, values in DEFAULT_GOALS.items():
        if category in existing_categories:
            continue
        db.add(models.Goal(user_id=user.id, category=category, **values))

    if len(existing_categories) < len(DEFAULT_GOALS):
        db.commit()

    return list(
        db.scalars(
            select(models.Goal)
            .where(models.Goal.user_id == user.id)
            .order_by(models.Goal.category.asc(), models.Goal.created_at.asc())
        )
    )


def get_goal(db: Session, goal_id: str, user: models.User) -> models.Goal | None:
    return db.scalar(select(models.Goal).where(models.Goal.id == goal_id, models.Goal.user_id == user.id))


def create_goal(db: Session, goal: schemas.GoalCreate, user: models.User) -> models.Goal:
    db_goal = models.Goal(**goal.model_dump(), user_id=user.id)
    db.add(db_goal)
    db.commit()
    db.refresh(db_goal)
    return db_goal


def update_goal(db: Session, goal_id: str, goal: schemas.GoalUpdate, user: models.User) -> models.Goal | None:
    db_goal = get_goal(db, goal_id, user)
    if db_goal is None:
        return None

    for key, value in goal.model_dump(exclude_unset=True).items():
        setattr(db_goal, key, value)

    db.commit()
    db.refresh(db_goal)
    return db_goal


def get_goals_overview(db: Session, user: models.User) -> schemas.GoalsOverview:
    goals = ensure_default_goals(db, user)
    active_tasks = list_goal_active_tasks(db, user)
    completions = list_recent_goal_completions(db, user)
    insight = _latest_personality_insight(goals)

    return schemas.GoalsOverview(
        goals=goals,
        active_tasks=[_goal_task_read(task) for task in active_tasks],
        recent_completed_tasks=completions,
        personality_insight=insight,
    )


def list_goal_active_tasks(db: Session, user: models.User) -> list[models.Task]:
    query = (
        select(models.Task)
        .join(models.Project)
        .outerjoin(models.Goal)
        .where(models.Project.user_id == user.id, models.Task.status != models.TaskStatus.done)
        .options(selectinload(models.Task.project), selectinload(models.Task.goal))
        .order_by(models.Task.importance_rating.desc(), models.Task.created_at.desc())
    )
    return list(db.scalars(query))


def list_recent_goal_completions(db: Session, user: models.User, limit: int = 12) -> list[models.CompletedGoalLog]:
    return list(
        db.scalars(
            select(models.CompletedGoalLog)
            .where(models.CompletedGoalLog.user_id == user.id)
            .order_by(models.CompletedGoalLog.created_at.desc())
            .limit(limit)
        )
    )


def log_goal_entry(db: Session, request: schemas.GoalLogRequest, user: models.User) -> schemas.GoalLogResponse:
    raw_text = request.text.strip()
    marker = raw_text[0]
    body = raw_text[1:].strip() if marker in {"+", "-"} else raw_text
    goals = ensure_default_goals(db, user)
    classification = classify_goal_log(body, goals, user_id=user.id, usage_db=db)
    corrected_text = str(classification.get("corrected_text") or body).strip()[:220]
    goal_id = _clean_text(classification.get("goal_id"))
    db_goal = get_goal(db, goal_id, user) if goal_id else None
    related_goal = db_goal.title if db_goal else str(classification.get("related_goal") or "General")[:80]

    if marker == "+":
        task = create_goal_task_from_log(
            db=db,
            user=user,
            title=corrected_text,
            goal=db_goal,
            related_goal=related_goal,
            estimated_minutes=_bounded_int(classification.get("estimated_minutes"), 5, 480, 60),
            importance=_bounded_int(classification.get("importance"), 1, 5, 3),
        )
        return schemas.GoalLogResponse(
            mode="created_task",
            corrected_text=corrected_text,
            related_goal=related_goal,
            task=_goal_task_read(task),
        )

    completion = create_goal_completion_log(db, user, corrected_text, db_goal, related_goal)
    return schemas.GoalLogResponse(
        mode="completed_task",
        corrected_text=corrected_text,
        related_goal=related_goal,
        completion=completion,
    )


def create_goal_task_from_log(
    db: Session,
    user: models.User,
    title: str,
    goal: models.Goal | None,
    related_goal: str,
    estimated_minutes: int,
    importance: int,
) -> models.Task:
    project = _get_or_create_goal_inbox_project(db, user)
    priority = models.TaskPriority.high if importance >= 4 else models.TaskPriority.low if importance <= 2 else models.TaskPriority.medium
    db_task = models.Task(
        project_id=project.id,
        goal_id=goal.id if goal else None,
        title=title,
        description=f"Related goal: {related_goal}",
        status=models.TaskStatus.todo,
        priority=priority,
        importance_rating=importance,
        eta_hours=round(estimated_minutes / 60, 2),
        time_spent_hours=0,
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


def complete_goal_task(db: Session, task_id: str, user: models.User) -> schemas.CompletedGoalLogRead | None:
    db_task = db.scalar(
        select(models.Task)
        .join(models.Project)
        .where(models.Task.id == task_id, models.Project.user_id == user.id)
        .options(selectinload(models.Task.goal))
    )
    if db_task is None:
        return None

    db_task.status = models.TaskStatus.done
    if db_task.goal and db_task.goal.measurable:
        db_task.goal.current_value = min(db_task.goal.current_value + _task_progress_delta(db_task), db_task.goal.target_value or 0)
    goal_label = db_task.goal.title if db_task.goal else "General"
    db_log = models.CompletedGoalLog(
        user_id=user.id,
        goal_id=db_task.goal_id,
        task_id=db_task.id,
        title=db_task.title,
        goal_label=goal_label[:80],
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log


def restore_goal_completion(db: Session, completion_id: str, user: models.User) -> models.Task | None:
    db_log = db.scalar(
        select(models.CompletedGoalLog)
        .where(models.CompletedGoalLog.id == completion_id, models.CompletedGoalLog.user_id == user.id)
        .options(selectinload(models.CompletedGoalLog.goal))
    )
    if db_log is None:
        return None

    db_task = None
    if db_log.task_id:
        db_task = db.scalar(
            select(models.Task)
            .join(models.Project)
            .where(models.Task.id == db_log.task_id, models.Project.user_id == user.id)
            .options(selectinload(models.Task.project), selectinload(models.Task.goal))
        )

    if db_task is None:
        project = _get_or_create_goal_inbox_project(db, user)
        db_task = models.Task(
            project_id=project.id,
            goal_id=db_log.goal_id,
            title=db_log.title,
            description=f"Restored from completed log: {db_log.goal_label}",
            status=models.TaskStatus.todo,
            priority=models.TaskPriority.medium,
            importance_rating=3,
            eta_hours=1,
            time_spent_hours=0,
        )
        db.add(db_task)
        db.flush()
        db_task.project = project
        db_task.goal = db_log.goal
    else:
        db_task.status = models.TaskStatus.todo
        db_task.start_date = None

    if db_log.goal and db_log.goal.measurable:
        delta = _task_progress_delta(db_task) if db_log.task_id else _extract_progress_delta(db_log.title, db_log.goal)
        db_log.goal.current_value = max(db_log.goal.current_value - delta, 0)

    db.delete(db_log)
    db.commit()
    db.refresh(db_task)
    return db_task


def create_goal_completion_log(
    db: Session,
    user: models.User,
    title: str,
    goal: models.Goal | None,
    goal_label: str,
) -> models.CompletedGoalLog:
    if goal and goal.measurable:
        delta = _extract_progress_delta(title, goal)
        if delta > 0:
            goal.current_value = min(goal.current_value + delta, goal.target_value or 0)
    db_log = models.CompletedGoalLog(
        user_id=user.id,
        goal_id=goal.id if goal else None,
        title=title,
        goal_label=goal_label[:80],
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log


def refresh_personality_insight(db: Session, user: models.User) -> schemas.PersonalityInsightRead:
    goals = ensure_default_goals(db, user)
    completions = list_recent_goal_completions(db, user, limit=20)
    insight = generate_personality_insight(goals, completions, user_id=user.id, usage_db=db)
    now = datetime.now(timezone.utc)
    for goal in goals:
        goal.personality_insight = insight
        goal.personality_refreshed_at = now
    db.commit()
    return schemas.PersonalityInsightRead(text=insight, refreshed_at=now)


def suggest_goal_next_actions(db: Session, user: models.User) -> list[schemas.GoalNextActionRead]:
    goals = ensure_default_goals(db, user)
    completions = list_recent_goal_completions(db, user, limit=20)
    active_tasks = list_goal_active_tasks(db, user)
    actions = generate_goal_next_actions(goals, completions, active_tasks, user_id=user.id, usage_db=db)
    return [schemas.GoalNextActionRead(**action) for action in actions[:5]]


def classify_goal_log(
    text: str,
    goals: list[models.Goal],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict:
    fallback = _fallback_goal_log_classification(text, goals)
    context = {
        "text": text,
        "goals": [
            {
                "goal_id": goal.id,
                "category": goal.category.value,
                "title": goal.title,
                "target_value": goal.target_value,
                "current_value": goal.current_value,
                "unit": goal.unit,
            }
            for goal in goals
        ],
    }
    data = _call_openai_json(
        GOAL_LOG_SYSTEM_PROMPT,
        f"{GOAL_LOG_USER_PROMPT} Context: {json.dumps(context)}",
        max_tokens=700,
        feature="goal_log_classification",
        user_id=user_id,
        usage_db=usage_db,
    )
    if not isinstance(data, dict):
        return fallback
    if _clean_text(data.get("goal_id")) and _clean_text(data.get("goal_id")) not in {goal.id for goal in goals}:
        data["goal_id"] = None
        data["related_goal"] = "General"
    return {
        "corrected_text": _clean_text(data.get("corrected_text")) or fallback["corrected_text"],
        "goal_id": _clean_text(data.get("goal_id")),
        "related_goal": _clean_text(data.get("related_goal")) or fallback["related_goal"],
        "estimated_minutes": _bounded_int(data.get("estimated_minutes"), 5, 480, fallback["estimated_minutes"]),
        "importance": _bounded_int(data.get("importance"), 1, 5, fallback["importance"]),
    }


def generate_goal_next_actions(
    goals: list[models.Goal],
    completions: list[models.CompletedGoalLog],
    active_tasks: list[models.Task],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> list[dict]:
    fallback = _fallback_goal_next_actions(goals, active_tasks)
    context = {
        "goals": [_goal_context(goal) for goal in goals],
        "recent_completed_tasks": [
            {"title": completion.title, "goal": completion.goal_label, "created_at": completion.created_at.isoformat()}
            for completion in completions
        ],
    }
    data = _call_openai_json(
        GOAL_NEXT_ACTIONS_SYSTEM_PROMPT,
        f"{GOAL_NEXT_ACTIONS_USER_PROMPT} Context: {json.dumps(context)}",
        max_tokens=900,
        feature="goal_next_actions",
        user_id=user_id,
        usage_db=usage_db,
    )
    items = data.get("actions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return fallback

    cleaned = []
    for item in items:
        if not isinstance(item, dict) or not _clean_text(item.get("title")):
            continue
        cleaned.append(
            {
                "title": str(item["title"])[:220],
                "related_goal": str(item.get("related_goal") or "General")[:120],
                "importance": _bounded_int(item.get("importance"), 1, 5, 3),
                "urgency": _bounded_int(item.get("urgency"), 1, 5, 3),
            }
        )
        if len(cleaned) == 5:
            break
    return cleaned or fallback


def generate_personality_insight(
    goals: list[models.Goal],
    completions: list[models.CompletedGoalLog],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> str:
    fallback = (
        "Your goals suggest a builder's personality: you respond well to clear execution targets, but you also keep a "
        "longer horizon in view. Recent completions will make this sharper over time. Right now, the useful pattern is "
        "to protect focused work blocks, keep next actions small enough to start, and review whether daily tasks are "
        "actually serving the larger yearly and five-year direction."
    )
    context = {
        "goals": [_goal_context(goal) for goal in goals],
        "recent_completed_tasks": [
            {"title": completion.title, "goal": completion.goal_label, "created_at": completion.created_at.isoformat()}
            for completion in completions
        ],
    }
    data = _call_openai_json(
        PERSONALITY_INSIGHT_SYSTEM_PROMPT,
        f"{PERSONALITY_INSIGHT_USER_PROMPT} Context: {json.dumps(context)}",
        max_tokens=700,
        feature="personality_insight",
        user_id=user_id,
        usage_db=usage_db,
    )
    insight = _clean_text(data.get("insight")) if isinstance(data, dict) else None
    return (insight or fallback)[:1200]


def _latest_personality_insight(goals: list[models.Goal]) -> schemas.PersonalityInsightRead:
    goal_with_insight = next((goal for goal in goals if goal.personality_insight), None)
    if goal_with_insight is None:
        return schemas.PersonalityInsightRead()
    return schemas.PersonalityInsightRead(
        text=goal_with_insight.personality_insight,
        refreshed_at=goal_with_insight.personality_refreshed_at,
    )


def _goal_task_read(task: models.Task) -> schemas.GoalTaskRead:
    return schemas.GoalTaskRead(
        id=task.id,
        project_id=task.project_id,
        project_name=task.project.name if task.project else "Unknown",
        goal_id=task.goal_id,
        goal_title=task.goal.title if task.goal else None,
        goal_category=task.goal.category if task.goal else None,
        title=task.title,
        status=task.status,
        priority=task.priority,
        importance_rating=task.importance_rating,
        eta_hours=task.eta_hours,
        time_required_minutes=round(task.eta_hours * 60),
        created_at=task.created_at,
    )


def _get_or_create_goal_inbox_project(db: Session, user: models.User) -> models.Project:
    project = db.scalar(
        select(models.Project).where(models.Project.user_id == user.id, models.Project.name == "Goal Inbox")
    )
    if project is not None:
        return project
    project = models.Project(user_id=user.id, name="Goal Inbox", type=models.ProjectType.continuous)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def _fallback_goal_log_classification(text: str, goals: list[models.Goal]) -> dict:
    cleaned = " ".join(text.strip().split())
    matched_goal = _match_goal_by_words(cleaned, goals)
    estimated_minutes = _extract_minutes(cleaned) or 60
    importance = 3
    if matched_goal and matched_goal.category in {models.GoalCategory.monthly, models.GoalCategory.quarterly}:
        importance = 4
    if matched_goal and matched_goal.category == models.GoalCategory.five_year:
        importance = 5
    return {
        "corrected_text": cleaned[:220],
        "goal_id": matched_goal.id if matched_goal else None,
        "related_goal": matched_goal.title if matched_goal else "General",
        "estimated_minutes": estimated_minutes,
        "importance": importance,
    }


def _match_goal_by_words(text: str, goals: list[models.Goal]) -> models.Goal | None:
    words = {word.strip(".,:;!?()[]").lower() for word in text.split() if len(word.strip(".,:;!?()[]")) > 3}
    best_goal = None
    best_score = 0
    for goal in goals:
        goal_words = {word.strip(".,:;!?()[]").lower() for word in goal.title.split() if len(word.strip(".,:;!?()[]")) > 3}
        score = len(words & goal_words)
        if score > best_score:
            best_score = score
            best_goal = goal
    return best_goal if best_score > 0 else None


def _extract_minutes(text: str) -> int | None:
    import re

    match = re.search(r"(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b", text, re.IGNORECASE)
    if match:
        return _bounded_int(float(match.group(1)), 5, 480, 60)
    match = re.search(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b", text, re.IGNORECASE)
    if match:
        return _bounded_int(float(match.group(1)) * 60, 5, 480, 60)
    return None


def _extract_progress_delta(text: str, goal: models.Goal) -> float:
    import re

    if goal.unit and "hour" in goal.unit.lower():
        hour_match = re.search(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b", text, re.IGNORECASE)
        if hour_match:
            return float(hour_match.group(1))
        minute_match = re.search(r"(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b", text, re.IGNORECASE)
        if minute_match:
            return round(float(minute_match.group(1)) / 60, 2)
    number_match = re.search(r"(\d+(?:\.\d+)?)", text)
    return float(number_match.group(1)) if number_match else 0


def _task_progress_delta(task: models.Task) -> float:
    if task.goal and task.goal.unit and "hour" in task.goal.unit.lower():
        return task.eta_hours
    return 1


def _fallback_goal_next_actions(goals: list[models.Goal], active_tasks: list[models.Task]) -> list[dict]:
    actions = [
        {
            "title": task.title,
            "related_goal": task.goal.title if task.goal else "General",
            "importance": task.importance_rating,
            "urgency": 4 if task.importance_rating >= 4 else 3,
        }
        for task in active_tasks[:5]
    ]
    for goal in goals:
        if len(actions) == 5:
            break
        actions.append(
            {
                "title": f"Define the next concrete step for {GOAL_CATEGORY_LABELS[goal.category].lower()}",
                "related_goal": goal.title,
                "importance": 4 if goal.category != models.GoalCategory.yearly else 3,
                "urgency": 3,
            }
        )
    return actions[:5]


def _goal_context(goal: models.Goal) -> dict:
    return {
        "goal_id": goal.id,
        "category": goal.category.value,
        "title": goal.title,
        "target_value": goal.target_value,
        "current_value": goal.current_value,
        "unit": goal.unit,
        "progress_percentage": goal.progress_percentage,
    }


def _bounded_int(value: object, minimum: int, maximum: int, default: int) -> int:
    try:
        parsed = round(float(value))
    except (TypeError, ValueError):
        return default
    return min(max(parsed, minimum), maximum)


def create_book(db: Session, book: schemas.BookCreate, user: models.User) -> models.Book:
    book_data = book.model_dump()
    book_data["author"] = _clean_text(book.author)
    book_data["category"] = _clean_text(book.category) or "Uncategorized"
    book_data["area"] = book_data["category"]
    book_data["purchased_at"] = book_data["purchase_date"]
    book_data["purchase_price"] = book_data["purchase_price"] or 0
    db_book = models.Book(**book_data, user_id=user.id)
    db.add(db_book)
    db.commit()
    db.refresh(db_book)
    return db_book


def list_books(db: Session, user: models.User) -> list[models.Book]:
    query = (
        select(models.Book)
        .where(models.Book.user_id == user.id)
        .options(selectinload(models.Book.chapters), selectinload(models.Book.reading_logs))
        .order_by(models.Book.purchase_date.desc().nullslast(), models.Book.created_at.desc())
    )
    return list(db.scalars(query))


def get_book(db: Session, book_id: str, user: models.User | None = None) -> models.Book | None:
    query = (
        select(models.Book)
        .where(models.Book.id == book_id)
        .options(selectinload(models.Book.chapters), selectinload(models.Book.reading_logs))
    )
    if user is not None:
        query = query.where(models.Book.user_id == user.id)
    return db.scalar(query)


def update_book(db: Session, book_id: str, book: schemas.BookUpdate, user: models.User) -> models.Book | None:
    db_book = get_book(db, book_id, user)
    if db_book is None:
        return None

    changes = book.model_dump(exclude_unset=True)
    if "category" in changes:
        changes["area"] = changes["category"]
    if "purchase_date" in changes:
        changes["purchased_at"] = changes["purchase_date"]
    if "purchase_price" in changes and changes["purchase_price"] is None:
        changes["purchase_price"] = 0

    for key, value in changes.items():
        setattr(db_book, key, value)

    db.commit()
    db.refresh(db_book)
    return db_book


def update_chapter(db: Session, chapter_id: str, chapter: schemas.ChapterUpdate, user: models.User) -> models.BookChapter | None:
    db_chapter = db.scalar(
        select(models.BookChapter)
        .join(models.Book)
        .where(models.BookChapter.id == chapter_id, models.Book.user_id == user.id)
    )
    if db_chapter is None:
        return None

    db_chapter.resonated = chapter.resonated
    db_chapter.is_liked = chapter.resonated
    db.commit()
    db.refresh(db_chapter)
    return db_chapter


def create_chapter(db: Session, book_id: str, chapter: schemas.ChapterCreate, user: models.User) -> models.BookChapter | None:
    if get_book(db, book_id, user) is None:
        return None

    last_position = db.scalar(
        select(models.BookChapter.position)
        .where(models.BookChapter.book_id == book_id)
        .order_by(models.BookChapter.position.desc())
        .limit(1)
    )
    db_chapter = models.BookChapter(book_id=book_id, title=chapter.title.strip(), position=(last_position or 0) + 1)
    db.add(db_chapter)
    db.commit()
    db.refresh(db_chapter)
    return db_chapter


def delete_chapter(db: Session, chapter_id: str, user: models.User) -> bool:
    db_chapter = db.scalar(
        select(models.BookChapter)
        .join(models.Book)
        .where(models.BookChapter.id == chapter_id, models.Book.user_id == user.id)
    )
    if db_chapter is None:
        return False

    db.delete(db_chapter)
    db.commit()
    return True


def delete_book_chapters(db: Session, book_id: str, user: models.User) -> bool:
    db_book = get_book(db, book_id, user)
    if db_book is None:
        return False

    for chapter in list(db_book.chapters):
        db.delete(chapter)
    db.commit()
    return True


def enrich_book_metadata(db: Session, book_id: str, replace_chapters: bool = False) -> models.Book | None:
    db_book = get_book(db, book_id)
    if db_book is None:
        return None

    metadata = resolve_book_metadata(
        title=db_book.title,
        author=db_book.author,
        category=db_book.category if db_book.category != "Uncategorized" else None,
        user_id=db_book.user_id,
        usage_db=db,
    )
    if metadata["title"]:
        db_book.title = str(metadata["title"])
    if metadata["author"]:
        db_book.author = str(metadata["author"])
    if (not db_book.category or db_book.category == "Uncategorized") and metadata["category"]:
        db_book.category = str(metadata["category"])
        db_book.area = db_book.category

    chapter_titles = metadata["chapters"]
    if chapter_titles and (replace_chapters or not db_book.chapters):
        for chapter in list(db_book.chapters):
            db.delete(chapter)
        db.flush()
        for index, title in enumerate(chapter_titles, start=1):
            db.add(models.BookChapter(book_id=db_book.id, title=str(title), position=index))

    db.commit()
    db.refresh(db_book)
    return db_book


def create_reading_log(db: Session, reading_log: schemas.ReadingLogCreate, user: models.User) -> models.ReadingLog | None:
    db_book = get_book(db, reading_log.book_id, user)
    if db_book is None:
        return None

    data = reading_log.model_dump()
    if data["start_page"] is not None and data["end_page"] is not None:
        data["pages_read"] = data["end_page"] - data["start_page"] + 1
    if not data["pages_read"] or data["pages_read"] < 1:
        return None
    if data["read_at"] is None:
        data["read_at"] = datetime.now(timezone.utc)
    data["read_on"] = data["read_at"]

    db_log = models.ReadingLog(**data)
    db.add(db_log)
    if data["end_page"] is not None:
        db_book.current_page = max(db_book.current_page, data["end_page"])
        if db_book.total_pages and db_book.current_page >= db_book.total_pages:
            db_book.status = models.BookStatus.read
        elif db_book.status == models.BookStatus.yet_to_start:
            db_book.status = models.BookStatus.reading
    db.commit()
    db.refresh(db_log)
    return db_log


def list_reading_logs(db: Session, user: models.User) -> list[models.ReadingLog]:
    return list(
        db.scalars(
            select(models.ReadingLog)
            .join(models.Book)
            .where(models.Book.user_id == user.id)
            .order_by(models.ReadingLog.read_at.desc())
        )
    )


def get_library_summary(db: Session, user: models.User) -> schemas.LibrarySummary:
    books = list(
        db.scalars(
            select(models.Book)
            .where(models.Book.user_id == user.id)
            .order_by(models.Book.purchase_date.desc().nullslast(), models.Book.created_at.desc())
        )
    )
    logs = list_reading_logs(db, user)
    now = datetime.now(timezone.utc)
    today = now.date()
    week_start = today - timedelta(days=today.weekday())
    active_categories = sorted({book.category for book in books if book.status == models.BookStatus.reading})

    daily_pages = []
    for days_back in range(364, -1, -1):
        day = today - timedelta(days=days_back)
        daily_pages.append(
            {
                "date": day.isoformat(),
                "pages": sum(log.pages_read for log in logs if _as_aware(log.read_at).date() == day),
            }
        )
    daywise_pages = daily_pages[-7:]

    monthly_pages = []
    for year, month in _last_12_months(now):
        monthly_pages.append(
            {
                "month": f"{year}-{month:02d}",
                "pages": sum(
                    log.pages_read
                    for log in logs
                    if _as_aware(log.read_at).year == year and _as_aware(log.read_at).month == month
                ),
            }
        )

    category_counts: dict[str, int] = {}
    for book in books:
        category_counts[book.category] = category_counts.get(book.category, 0) + 1

    return schemas.LibrarySummary(
        total_books=len(books),
        read_books=sum(book.status == models.BookStatus.read for book in books),
        liked_books=sum(book.liked for book in books),
        yet_to_start_books=sum(book.status == models.BookStatus.yet_to_start for book in books),
        reading_books=sum(book.status == models.BookStatus.reading for book in books),
        pages_today=sum(log.pages_read for log in logs if _as_aware(log.read_at).date() == today),
        pages_this_week=sum(log.pages_read for log in logs if _as_aware(log.read_at).date() >= week_start),
        first_reading_date=min((_as_aware(log.read_at).date() for log in logs), default=None),
        current_categories=active_categories,
        daywise_pages=daywise_pages,
        daily_pages=daily_pages,
        monthly_pages=monthly_pages,
        categories=[{"category": category, "books": count} for category, count in sorted(category_counts.items())],
    )


def _last_12_months(value: datetime) -> list[tuple[int, int]]:
    months = []
    year = value.year
    month = value.month
    for _ in range(12):
        months.append((year, month))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return list(reversed(months))


def suggest_books(db: Session, user: models.User) -> list[schemas.SuggestedBook]:
    books = list_books(db, user)
    three_months_ago = datetime.now(timezone.utc) - timedelta(days=90)
    recent_books = [
        book
        for book in books
        if book.purchase_date is not None and _as_aware(book.purchase_date) >= three_months_ago
    ]
    suggestions = generate_book_suggestions(recent_books or books, user_id=user.id, usage_db=db)
    return [schemas.SuggestedBook(**suggestion) for suggestion in suggestions]


def suggest_next_owned_books(db: Session, user: models.User) -> list[schemas.OwnedBookRecommendation]:
    candidates = [book for book in list_books(db, user) if book.status != models.BookStatus.read]
    recommendations = generate_next_owned_book_suggestions(candidates, user_id=user.id, usage_db=db)
    return [schemas.OwnedBookRecommendation(**recommendation) for recommendation in recommendations]


def resolve_book_metadata(
    title: str,
    author: str | None,
    category: str | None,
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict[str, str | None | list[str]]:
    provided_author = _clean_text(author)
    provided_category = _clean_text(category)
    metadata = {
        "title": None,
        "author": provided_author,
        "category": provided_category or "Uncategorized",
        "chapters": [],
    }
    data = fetch_book_metadata(
        title=title,
        author=provided_author,
        category=provided_category,
        user_id=user_id,
        usage_db=usage_db,
    )
    if not data:
        return metadata

    confidence = _as_float(data.get("confidence"))
    if data.get("identified") is not True or confidence < 0.82:
        return metadata

    corrected_title = _clean_text(data.get("corrected_title"))
    if corrected_title:
        metadata["title"] = corrected_title

    corrected_author = _clean_text(data.get("corrected_author"))
    if corrected_author:
        metadata["author"] = corrected_author

    if not provided_category:
        model_category = _clean_text(data.get("category"))
        if model_category:
            metadata["category"] = model_category

    chapters = data.get("chapters")
    if data.get("chapters_confident") is True and isinstance(chapters, list):
        metadata["chapters"] = [str(chapter).strip()[:240] for chapter in chapters if str(chapter).strip()][:80]

    return metadata


def fetch_book_metadata(
    title: str,
    author: str | None,
    category: str | None,
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict:
    prompt = f"{BOOK_METADATA_USER_PROMPT} Context: {json.dumps({'title': title, 'author': author, 'category': category})}"
    return _call_openai_json(
        BOOK_METADATA_SYSTEM_PROMPT,
        prompt,
        max_tokens=1200,
        feature="book_metadata",
        user_id=user_id,
        usage_db=usage_db,
    )


def resolve_pomodoro_assignment(
    note: str,
    candidates: list[dict],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict:
    prompt = f"{POMODORO_ASSIGNMENT_USER_PROMPT} Context: {json.dumps({'note': note, 'candidates': candidates})}"
    return _call_openai_json(
        POMODORO_ASSIGNMENT_SYSTEM_PROMPT,
        prompt,
        max_tokens=700,
        feature="pomodoro_assignment",
        user_id=user_id,
        usage_db=usage_db,
    )


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def generate_book_suggestions(
    books: list[models.Book],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> list[dict[str, str | None]]:
    fallback = _fallback_suggestions(books)
    if not books:
        return fallback

    recent_context = [
        {
            "title": book.title,
            "author": book.author,
            "category": book.category,
            "liked": book.liked,
            "status": book.status.value,
        }
        for book in books[:12]
    ]
    prompt = (
        f"{BOOK_RECOMMENDATIONS_USER_PROMPT} History: {json.dumps(recent_context)}"
    )
    data = _call_openai_json(
        BOOK_RECOMMENDATIONS_SYSTEM_PROMPT,
        prompt,
        max_tokens=900,
        feature="book_recommendations",
        user_id=user_id,
        usage_db=usage_db,
    )
    suggestions = data.get("suggestions") if isinstance(data, dict) else None
    if not isinstance(suggestions, list):
        return fallback

    cleaned = []
    for item in suggestions[:3]:
        if not isinstance(item, dict) or not item.get("title") or not item.get("reason"):
            continue
        cleaned.append(
            {
                "title": str(item["title"])[:220],
                "author": str(item["author"])[:160] if item.get("author") else None,
                "category": str(item.get("category") or "General")[:80],
                "reason": str(item["reason"])[:320],
            }
        )

    return cleaned or fallback


def generate_next_owned_book_suggestions(
    books: list[models.Book],
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> list[dict[str, str | None]]:
    fallback = _fallback_owned_book_suggestions(books)
    if not books:
        return fallback

    candidates = [
        {
            "book_id": book.id,
            "title": book.title,
            "author": book.author,
            "category": book.category,
            "status": book.status.value,
            "liked": book.liked,
            "rating": book.rating,
            "pages_read": book.pages_read,
            "pages_remaining": book.pages_remaining,
            "purchase_date": book.purchase_date.isoformat() if book.purchase_date else None,
        }
        for book in books[:30]
    ]
    prompt = f"{OWNED_BOOK_NEXT_READ_USER_PROMPT} Candidates: {json.dumps(candidates)}"
    data = _call_openai_json(
        OWNED_BOOK_NEXT_READ_SYSTEM_PROMPT,
        prompt,
        max_tokens=900,
        feature="next_reading_recommendations",
        user_id=user_id,
        usage_db=usage_db,
    )
    items = data.get("recommendations") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return fallback

    books_by_id = {book.id: book for book in books}
    cleaned = []
    seen_ids = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        book_id = str(item.get("book_id") or "")
        if book_id in seen_ids or book_id not in books_by_id:
            continue
        seen_ids.add(book_id)
        book = books_by_id[book_id]
        cleaned.append(_owned_book_recommendation(book, str(item.get("reason") or "Good next pick from your purchased shelf.")))
        if len(cleaned) == 3:
            break

    return cleaned or fallback


def _call_openai_json(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    *,
    feature: str,
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.warning("OPENAI_API_KEY is not set. Skipping OpenAI LLM call.")
        return {}

    if OpenAI is None:
        logger.warning("OpenAI Python SDK is not installed. Run `pip install -r backend/requirements.txt`.")
        return {}

    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    started_at = perf_counter()

    try:
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            text={"format": {"type": "json_object"}},
            max_output_tokens=max_tokens,
        )
    except (OpenAIError, OSError) as err:
        ai_service.record_ai_usage(
            db=usage_db,
            user_id=user_id,
            feature=feature,
            model=model,
            response_id=None,
            status="failed",
            latency_ms=round((perf_counter() - started_at) * 1000),
        )
        logger.warning("OpenAI LLM call failed: %s", err)
        return {}

    text = getattr(response, "output_text", None) or _extract_response_text(response)
    usage = getattr(response, "usage", None)
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    cached_input_tokens = int(getattr(input_details, "cached_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    reasoning_tokens = int(getattr(output_details, "reasoning_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", input_tokens + output_tokens) or 0)

    try:
        data = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        ai_service.record_ai_usage(
            db=usage_db,
            user_id=user_id,
            feature=feature,
            model=str(getattr(response, "model", model) or model),
            response_id=getattr(response, "id", None),
            input_tokens=input_tokens,
            cached_input_tokens=cached_input_tokens,
            output_tokens=output_tokens,
            reasoning_tokens=reasoning_tokens,
            total_tokens=total_tokens,
            status="invalid_json",
            latency_ms=round((perf_counter() - started_at) * 1000),
        )
        logger.warning("OpenAI LLM returned non-JSON content.")
        return {}

    ai_service.record_ai_usage(
        db=usage_db,
        user_id=user_id,
        feature=feature,
        model=str(getattr(response, "model", model) or model),
        response_id=getattr(response, "id", None),
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
        reasoning_tokens=reasoning_tokens,
        total_tokens=total_tokens,
        status="success",
        latency_ms=round((perf_counter() - started_at) * 1000),
    )
    return data


def _extract_response_text(response: object) -> str:
    response_dict = response.model_dump() if hasattr(response, "model_dump") else {}
    text_parts = []
    for output in response_dict.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                text_parts.append(content.get("text", ""))
    return "".join(text_parts)


def _fallback_suggestions(books: list[models.Book]) -> list[dict[str, str | None]]:
    favorite_categories = [book.category for book in books if book.liked] or [book.category for book in books]
    top_category = favorite_categories[0] if favorite_categories else "Software Development"
    return [
        {
            "title": "Designing Data-Intensive Applications",
            "author": "Martin Kleppmann",
            "category": "Software Development",
            "reason": "A strong next buy if your shelf leans toward technical depth and durable systems thinking.",
        },
        {
            "title": "The Beginning of Infinity",
            "author": "David Deutsch",
            "category": "Philosophy",
            "reason": f"Pairs well with your recent interest in {top_category} while widening the idea-space.",
        },
        {
            "title": "Thinking in Systems",
            "author": "Donella H. Meadows",
            "category": "Psychology",
            "reason": "Good bridge material for connecting human behavior, strategy, and technical decision-making.",
        },
    ]


def _fallback_owned_book_suggestions(books: list[models.Book]) -> list[dict[str, str | None]]:
    ranked = sorted(
        books,
        key=lambda book: (
            book.status != models.BookStatus.reading,
            -(book.rating or 0),
            not book.liked,
            _as_aware(book.purchase_date or book.created_at),
        ),
    )
    return [
        _owned_book_recommendation(book, "A strong next choice from your purchased shelf based on status, rating, and recency.")
        for book in ranked[:3]
    ]


def _owned_book_recommendation(book: models.Book, reason: str) -> dict[str, str | None]:
    return {
        "book_id": book.id,
        "title": book.title,
        "author": book.author,
        "category": book.category,
        "status": book.status.value,
        "reason": reason[:320],
    }
