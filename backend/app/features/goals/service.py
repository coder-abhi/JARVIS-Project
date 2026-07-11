import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models, schemas
from ...prompts import (
    CAPTAIN_COMPASS_SYSTEM_PROMPT,
    CAPTAIN_COMPASS_USER_PROMPT,
    GOAL_LOG_SYSTEM_PROMPT,
    GOAL_LOG_USER_PROMPT,
    GOAL_NEXT_ACTIONS_SYSTEM_PROMPT,
    GOAL_NEXT_ACTIONS_USER_PROMPT,
    PERSONALITY_INSIGHT_SYSTEM_PROMPT,
    PERSONALITY_INSIGHT_USER_PROMPT,
)
from ...shared.utils import as_utc, bounded_int, canonical_json, clean_text
from ..ai import service as ai_service
from ..projects.repository import (
    get_or_create_general_work_project,
    get_project,
    get_user_projects_by_ids,
    list_projects,
)
from ..tasks.service import create_task_completion_log, task_linked_goals, task_progress_delta
from .repository import (
    get_goal,
    list_goal_active_tasks,
    list_goal_completions_by_project,
    list_recent_goal_completions,
)

__all__ = [
    "CAPTAIN_COMPASS_CONTEXT_DAYS",
    "complete_goal_task",
    "create_goal",
    "create_goal_completion_log",
    "create_goal_task_from_log",
    "delete_goal_completion",
    "ensure_default_goals",
    "generate_captain_compass",
    "generate_goal_next_actions",
    "generate_personality_insight",
    "get_captain_compass",
    "get_goal",
    "get_goals_overview",
    "goal_context",
    "goal_task_read",
    "list_goal_active_tasks",
    "list_goal_completions_by_project",
    "list_recent_goal_completions",
    "log_goal_entry",
    "refresh_personality_insight",
    "restore_goal_completion",
    "suggest_goal_next_actions",
    "update_goal",
]

CAPTAIN_COMPASS_CONTEXT_DAYS = (7, 30, 90)

GOAL_CATEGORY_LABELS = {
    models.GoalCategory.monthly: "Monthly Goals",
    models.GoalCategory.quarterly: "Quarterly Goals",
    models.GoalCategory.yearly: "Yearly Goals",
    models.GoalCategory.five_year: "5-Year Goals",
}

DEFAULT_GOALS = {
    models.GoalCategory.monthly: {
        "title": "Complete 20 study hours this month",
        "description": "Study sessions, coursework, deliberate practice, and learning reviews.",
        "target_value": 20,
        "current_value": 0,
        "unit": "study hours",
    },
    models.GoalCategory.quarterly: {
        "title": "Ship one meaningful project improvement this quarter",
        "description": "Product improvements, releases, and concrete project milestones.",
        "target_value": None,
        "current_value": 0,
        "unit": None,
    },
    models.GoalCategory.yearly: {
        "title": "Build a durable personal execution system this year",
        "description": "Planning, focus, review, and productivity-system improvements.",
        "target_value": None,
        "current_value": 0,
        "unit": None,
    },
    models.GoalCategory.five_year: {
        "title": "Grow into a deeply capable, independent builder over five years",
        "description": "Long-term technical depth, independent creation, and professional growth.",
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
            .options(selectinload(models.Goal.linked_projects))
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
            .options(selectinload(models.Goal.linked_projects))
            .order_by(models.Goal.category.asc(), models.Goal.created_at.asc())
        )
    )


def create_goal(db: Session, goal: schemas.GoalCreate, user: models.User) -> models.Goal:
    goal_data = goal.model_dump(exclude={"linked_project_ids"})
    linked_projects = get_user_projects_by_ids(db, goal.linked_project_ids, user)
    goal_data["description"] = clean_text(goal_data.get("description"))
    db_goal = models.Goal(**goal_data, user_id=user.id)
    for project in linked_projects:
        project.linked_goals.append(db_goal)
        project.goal_id = project.linked_goals[0].id
    db.add(db_goal)
    db.commit()
    db.refresh(db_goal)
    return db_goal


def update_goal(db: Session, goal_id: str, goal: schemas.GoalUpdate, user: models.User) -> models.Goal | None:
    db_goal = get_goal(db, goal_id, user)
    if db_goal is None:
        return None

    changes = goal.model_dump(exclude_unset=True, exclude={"linked_project_ids"})
    if "description" in changes:
        changes["description"] = clean_text(changes["description"])
    for key, value in changes.items():
        setattr(db_goal, key, value)

    if "linked_project_ids" in goal.model_fields_set:
        linked_projects = get_user_projects_by_ids(db, goal.linked_project_ids or [], user)
        linked_project_ids = {project.id for project in linked_projects}
        for project in list(db_goal.linked_projects):
            if project.id not in linked_project_ids:
                project.linked_goals.remove(db_goal)
                project.goal_id = project.linked_goals[0].id if project.linked_goals else None
        for project in linked_projects:
            if db_goal not in project.linked_goals:
                project.linked_goals.append(db_goal)
            project.goal_id = project.linked_goals[0].id

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
        active_tasks=[goal_task_read(task) for task in active_tasks],
        recent_completed_tasks=completions,
        personality_insight=insight,
    )


def delete_goal_completion(db: Session, completion_id: str, user: models.User) -> bool:
    completion = db.scalar(
        select(models.CompletedGoalLog).where(
            models.CompletedGoalLog.id == completion_id,
            models.CompletedGoalLog.user_id == user.id,
        )
    )
    if completion is None:
        return False
    if completion.goal and completion.goal.measurable:
        delta = _extract_progress_delta(completion.title, completion.goal)
        completion.goal.current_value = max(completion.goal.current_value - delta, 0)
    db.delete(completion)
    db.commit()
    return True


def log_goal_entry(db: Session, request: schemas.GoalLogRequest, user: models.User) -> schemas.GoalLogResponse:
    raw_text = request.text.strip()
    marker = raw_text[0]
    body = raw_text[1:].strip() if marker in {"+", "-"} else raw_text
    goals = ensure_default_goals(db, user)
    projects = list_projects(db, user)
    classification = classify_goal_log(body, goals, projects, user_id=user.id, usage_db=db)
    corrected_text = str(classification.get("corrected_text") or body).strip()[:220]
    project_id = clean_text(classification.get("project_id"))
    db_project = get_project(db, project_id, user) if project_id else None
    if db_project is None:
        db_project = get_or_create_general_work_project(db, user)
    related_goal = ", ".join(goal.title for goal in db_project.linked_goals) or "General"

    if marker == "+":
        task = create_goal_task_from_log(
            db=db,
            title=corrected_text,
            project=db_project,
            estimated_minutes=bounded_int(classification.get("estimated_minutes"), 5, 480, 60),
            importance=bounded_int(classification.get("importance"), 1, 5, 3),
        )
        return schemas.GoalLogResponse(
            mode="created_task",
            corrected_text=corrected_text,
            related_goal=related_goal,
            task=goal_task_read(task),
        )

    completion = create_goal_completion_log(db, user, corrected_text, db_project)
    return schemas.GoalLogResponse(
        mode="completed_task",
        corrected_text=corrected_text,
        related_goal=related_goal,
        completion=completion,
    )


def create_goal_task_from_log(
    db: Session,
    title: str,
    project: models.Project,
    estimated_minutes: int,
    importance: int,
) -> models.Task:
    priority = models.TaskPriority.high if importance >= 4 else models.TaskPriority.low if importance <= 2 else models.TaskPriority.medium
    db_task = models.Task(
        project_id=project.id,
        title=title,
        description=None,
        status=models.TaskStatus.todo,
        priority=priority,
        importance_rating=importance,
        eta_hours=round(estimated_minutes / 60, 2),
        time_spent_hours=0,
    )
    db_task.project = project
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


def complete_goal_task(db: Session, task_id: str, user: models.User) -> schemas.CompletedGoalLogRead | None:
    db_task = db.scalar(
        select(models.Task)
        .join(models.Project)
        .where(models.Task.id == task_id, models.Project.user_id == user.id)
        .options(selectinload(models.Task.project).selectinload(models.Project.linked_goals))
    )
    if db_task is None:
        return None

    existing_log = db.scalar(
        select(models.CompletedGoalLog).where(
            models.CompletedGoalLog.user_id == user.id,
            models.CompletedGoalLog.task_id == db_task.id,
        )
    )
    if existing_log is not None:
        return existing_log

    db_task.status = models.TaskStatus.done
    db_task.completed_at = datetime.now(timezone.utc)
    db_task.completion_percentage = 100
    db_log = create_task_completion_log(db, db_task, user)
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
            .options(selectinload(models.Task.project).selectinload(models.Project.linked_goals))
        )

    if db_task is None:
        project = get_project(db, db_log.project_id, user) if db_log.project_id else None
        project = project or get_or_create_general_work_project(db, user)
        db_task = models.Task(
            project_id=project.id,
            title=db_log.title,
            description=f"Restored from completed log: {db_log.goal_label}",
            status=models.TaskStatus.todo,
            priority=models.TaskPriority.medium,
            importance_rating=3,
            eta_hours=1,
            time_spent_hours=0,
        )
        db.add(db_task)
        db_task.project = project
    else:
        db_task.status = models.TaskStatus.todo
        db_task.start_date = None
        db_task.completed_at = None
        db_task.completion_percentage = 0

    linked_goals = task_linked_goals(db_task)
    for goal in linked_goals:
        if goal.measurable:
            delta = task_progress_delta(db_task, goal) if db_log.task_id else _extract_progress_delta(db_log.title, goal)
            goal.current_value = max(goal.current_value - delta, 0)

    db.delete(db_log)
    db.commit()
    db.refresh(db_task)
    return db_task


def create_goal_completion_log(
    db: Session,
    user: models.User,
    title: str,
    project: models.Project,
) -> models.CompletedGoalLog:
    linked_goals = project.linked_goals
    for goal in linked_goals:
        if goal.measurable:
            delta = _extract_progress_delta(title, goal)
            if delta > 0:
                goal.current_value = min(goal.current_value + delta, goal.target_value or 0)
    logged_goal = linked_goals[0] if len(linked_goals) == 1 else None
    db_log = models.CompletedGoalLog(
        user_id=user.id,
        goal_id=logged_goal.id if logged_goal else None,
        project_id=project.id,
        title=title,
        goal_label=project.name[:80],
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log


def refresh_personality_insight(db: Session, user: models.User) -> schemas.PersonalityInsightRead:
    goals = ensure_default_goals(db, user)
    completions = list_recent_goal_completions(db, user, limit=20)
    insight = generate_personality_insight(
        goals,
        completions,
        user_id=user.id,
        usage_db=db,
        force_refresh=True,
    )
    now = datetime.now(timezone.utc)
    for goal in goals:
        goal.personality_insight = insight
        goal.personality_refreshed_at = now
    db.commit()
    return schemas.PersonalityInsightRead(text=insight, refreshed_at=now)


def suggest_goal_next_actions(
    db: Session,
    user: models.User,
    *,
    force_refresh: bool = False,
) -> list[schemas.GoalNextActionRead]:
    goals = ensure_default_goals(db, user)
    completions = list_recent_goal_completions(db, user, limit=20)
    active_tasks = list_goal_active_tasks(db, user)
    actions = generate_goal_next_actions(
        goals,
        completions,
        active_tasks,
        user_id=user.id,
        usage_db=db,
        force_refresh=force_refresh,
    )
    return [schemas.GoalNextActionRead(**action) for action in actions[:5]]


def get_captain_compass(
    db: Session,
    user: models.User,
    *,
    force_refresh: bool = False,
    context_days: int = 30,
    timezone_offset_minutes: int = 0,
) -> schemas.CaptainCompassRead:
    if context_days not in CAPTAIN_COMPASS_CONTEXT_DAYS:
        raise ValueError(f"Captain Compass context must be one of {CAPTAIN_COMPASS_CONTEXT_DAYS}")
    if not -840 <= timezone_offset_minutes <= 840:
        raise ValueError("Captain Compass timezone offset must be between -840 and 840 minutes")

    goals = ensure_default_goals(db, user)
    projects = list(
        db.scalars(
            select(models.Project)
            .where(models.Project.user_id == user.id)
            .options(
                selectinload(models.Project.linked_goals),
                selectinload(models.Project.tasks),
                selectinload(models.Project.pomodoro_sessions),
            )
            .order_by(models.Project.created_at.asc())
        )
    )
    completion_logs = list(
        db.scalars(
            select(models.CompletedGoalLog)
            .where(models.CompletedGoalLog.user_id == user.id)
            .order_by(models.CompletedGoalLog.created_at.asc())
        )
    )
    assessment = generate_captain_compass(
        goals,
        projects,
        completion_logs,
        user_id=user.id,
        usage_db=db,
        force_refresh=force_refresh,
        cache_only=not force_refresh,
        context_days=context_days,
        timezone_offset_minutes=timezone_offset_minutes,
    )
    return schemas.CaptainCompassRead(**assessment)


def classify_goal_log(
    text: str,
    goals: list[models.Goal],
    projects: list[models.Project] | None = None,
    user_id: str | None = None,
    usage_db: Session | None = None,
) -> dict:
    projects = projects or []
    fallback = _fallback_goal_log_classification(text, projects)
    context = {
        "text": text,
        "goals": [
            {
                "goal_id": goal.id,
                "category": goal.category.value,
                "title": goal.title,
                "description": goal.description,
                "target_value": goal.target_value,
                "current_value": goal.current_value,
                "unit": goal.unit,
            }
            for goal in goals
        ],
        "projects": [
            {
                "project_id": project.id,
                "name": project.name,
                "description": project.description,
                "type": project.type.value,
                "parent_goal_id": project.goal_id,
            }
            for project in projects
        ],
    }
    data = ai_service.call_ai_json(
        GOAL_LOG_SYSTEM_PROMPT,
        f"{GOAL_LOG_USER_PROMPT} Context: {canonical_json(context)}",
        max_tokens=700,
        feature="goal_log_classification",
        user_id=user_id,
        usage_db=usage_db,
    )
    if not isinstance(data, dict):
        return fallback
    project_id = clean_text(data.get("project_id"))
    if project_id not in {project.id for project in projects}:
        project_id = None
    return {
        "corrected_text": clean_text(data.get("corrected_text")) or fallback["corrected_text"],
        "project_id": project_id,
        "estimated_minutes": bounded_int(data.get("estimated_minutes"), 5, 480, fallback["estimated_minutes"]),
        "importance": bounded_int(data.get("importance"), 1, 5, fallback["importance"]),
    }


def generate_goal_next_actions(
    goals: list[models.Goal],
    completions: list[models.CompletedGoalLog],
    active_tasks: list[models.Task],
    user_id: str | None = None,
    usage_db: Session | None = None,
    force_refresh: bool = False,
) -> list[dict]:
    fallback = _fallback_goal_next_actions(goals, active_tasks)
    context = {
        "goals": [goal_context(goal) for goal in goals],
        "recent_completed_tasks": [
            {"title": completion.title, "goal": completion.goal_label, "created_at": completion.created_at.isoformat()}
            for completion in completions
        ],
        "active_tasks": [
            {
                "task_id": task.id,
                "title": task.title,
                "project_id": task.project_id,
                "project_name": task.project.name if task.project else "Unknown",
                "linked_goals": [
                    {"goal_id": goal.id, "category": goal.category.value, "title": goal.title}
                    for goal in task_linked_goals(task)
                ],
                "status": task.status.value,
                "priority": task.priority.value,
                "importance": task.importance_rating,
                "estimated_minutes": round(task.eta_hours * 60),
                "created_at": task.created_at.isoformat(),
            }
            for task in active_tasks
        ],
    }
    data = ai_service.call_ai_json(
        GOAL_NEXT_ACTIONS_SYSTEM_PROMPT,
        f"{GOAL_NEXT_ACTIONS_USER_PROMPT} Context: {canonical_json(context)}",
        max_tokens=900,
        feature="goal_next_actions",
        user_id=user_id,
        usage_db=usage_db,
        force_refresh=force_refresh,
    )
    items = data.get("actions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return fallback

    cleaned = []
    for item in items:
        if not isinstance(item, dict) or not clean_text(item.get("title")):
            continue
        cleaned.append(
            {
                "title": str(item["title"])[:220],
                "related_goal": str(item.get("related_goal") or "General")[:120],
                "importance": bounded_int(item.get("importance"), 1, 5, 3),
                "urgency": bounded_int(item.get("urgency"), 1, 5, 3),
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
    force_refresh: bool = False,
) -> str:
    fallback = (
        "Your goals suggest a builder's personality: you respond well to clear execution targets, but you also keep a "
        "longer horizon in view. Recent completions will make this sharper over time. Right now, the useful pattern is "
        "to protect focused work blocks, keep next actions small enough to start, and review whether daily tasks are "
        "actually serving the larger yearly and five-year direction."
    )
    context = {
        "goals": [goal_context(goal) for goal in goals],
        "recent_completed_tasks": [
            {"title": completion.title, "goal": completion.goal_label, "created_at": completion.created_at.isoformat()}
            for completion in completions
        ],
    }
    data = ai_service.call_ai_json(
        PERSONALITY_INSIGHT_SYSTEM_PROMPT,
        f"{PERSONALITY_INSIGHT_USER_PROMPT} Context: {canonical_json(context)}",
        max_tokens=700,
        feature="personality_insight",
        user_id=user_id,
        usage_db=usage_db,
        force_refresh=force_refresh,
    )
    insight = clean_text(data.get("insight")) if isinstance(data, dict) else None
    return (insight or fallback)[:1200]


def generate_captain_compass(
    goals: list[models.Goal],
    projects: list[models.Project],
    completion_logs: list[models.CompletedGoalLog],
    user_id: str | None = None,
    usage_db: Session | None = None,
    force_refresh: bool = False,
    cache_only: bool = False,
    context_days: int = 30,
    timezone_offset_minutes: int = 0,
) -> dict:
    if context_days not in CAPTAIN_COMPASS_CONTEXT_DAYS:
        raise ValueError(f"Captain Compass context must be one of {CAPTAIN_COMPASS_CONTEXT_DAYS}")
    if not -840 <= timezone_offset_minutes <= 840:
        raise ValueError("Captain Compass timezone offset must be between -840 and 840 minutes")

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=context_days)
    previous_cutoff = cutoff - timedelta(days=context_days)
    goal_horizon_context = _captain_compass_goals_by_horizon(goals, projects, completion_logs, cutoff)
    project_timelines = _captain_compass_project_timelines(projects, completion_logs, cutoff, now)
    previous_project_timelines = _captain_compass_project_timelines(
        projects,
        completion_logs,
        previous_cutoff,
        cutoff,
    )
    active_commitments = _captain_compass_active_commitments(projects, now)
    period_metrics = _captain_compass_period_metrics(project_timelines, timezone_offset_minutes)
    previous_period_metrics = _captain_compass_period_metrics(
        previous_project_timelines,
        timezone_offset_minutes,
    )
    fallback = _fallback_captain_compass(project_timelines, context_days)
    fallback["model"] = ai_service.resolve_ai_model(user_id=user_id, feature="captain_compass")

    context = {
        "time_context": {
            "selected_range_days": context_days,
            "period_started_local_date": _captain_compass_local_date(
                cutoff.isoformat(),
                timezone_offset_minutes,
            ),
            "period_ended_local_date": _captain_compass_local_date(
                now.isoformat(),
                timezone_offset_minutes,
            ),
            "timezone_offset_minutes": timezone_offset_minutes,
            "date_interpretation": "local dates equal UTC timestamps minus timezone_offset_minutes",
        },
        "goal_context": goal_horizon_context,
        "active_commitments": active_commitments,
        "recent_execution": {
            "projects": project_timelines,
        },
        "period_metrics": period_metrics,
        "previous_period_metrics": {
            "period_started_local_date": _captain_compass_local_date(
                previous_cutoff.isoformat(),
                timezone_offset_minutes,
            ),
            "period_ended_local_date": _captain_compass_local_date(
                cutoff.isoformat(),
                timezone_offset_minutes,
            ),
            **previous_period_metrics,
        },
        "data_quality_notes": _captain_compass_data_quality_notes(
            projects,
            completion_logs,
            project_timelines,
            cutoff,
            now,
        ),
    }
    data = ai_service.call_ai_json(
        CAPTAIN_COMPASS_SYSTEM_PROMPT,
        f"{CAPTAIN_COMPASS_USER_PROMPT} Context: {canonical_json(context)}",
        max_tokens=850,
        feature="captain_compass",
        user_id=user_id,
        usage_db=usage_db,
        force_refresh=force_refresh,
        cache_only=cache_only,
    )
    if not isinstance(data, dict):
        return fallback

    status = str(data.get("status") or fallback["status"]).strip().lower()
    if status not in {"on_track", "drifting", "stalled", "overextended"}:
        status = fallback["status"]
    return {
        "speed_rating": bounded_int(data.get("speed_rating"), 1, 10, fallback["speed_rating"]),
        "direction_rating": bounded_int(data.get("direction_rating"), 1, 10, fallback["direction_rating"]),
        "consistency_rating": bounded_int(data.get("consistency_rating"), 1, 10, fallback["consistency_rating"]),
        "overall_rating": bounded_int(data.get("overall_rating"), 1, 10, fallback["overall_rating"]),
        "status": status,
        "summary": (clean_text(data.get("summary")) or fallback["summary"])[:900],
        "advice": (clean_text(data.get("advice")) or fallback["advice"])[:320],
        "model": ai_service.resolve_ai_model(user_id=user_id, feature="captain_compass"),
        "refreshed_at": datetime.now(timezone.utc),
        "context_days": context_days,
    }


def goal_task_read(task: models.Task) -> schemas.GoalTaskRead:
    return schemas.GoalTaskRead(
        id=task.id,
        project_id=task.project_id,
        project_name=task.project.name if task.project else "Unknown",
        linked_goals=task_linked_goals(task),
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        importance_rating=task.importance_rating,
        completion_percentage=task.completion_percentage,
        eta_hours=task.eta_hours,
        time_spent_hours=task.time_spent_hours,
        time_required_minutes=round(task.eta_hours * 60),
        start_date=task.start_date,
        deadline=task.deadline,
        completed_at=task.completed_at,
        created_at=task.created_at,
    )


def goal_context(goal: models.Goal) -> dict:
    return {
        "goal_id": goal.id,
        "category": goal.category.value,
        "title": goal.title,
        "description": goal.description,
        "target_value": goal.target_value,
        "current_value": goal.current_value,
        "unit": goal.unit,
        "progress_percentage": goal.progress_percentage,
    }


def _latest_personality_insight(goals: list[models.Goal]) -> schemas.PersonalityInsightRead:
    goal_with_insight = next((goal for goal in goals if goal.personality_insight), None)
    if goal_with_insight is None:
        return schemas.PersonalityInsightRead()
    return schemas.PersonalityInsightRead(
        text=goal_with_insight.personality_insight,
        refreshed_at=goal_with_insight.personality_refreshed_at,
    )


def _fallback_goal_log_classification(text: str, projects: list[models.Project]) -> dict:
    cleaned = " ".join(text.strip().split())
    matched_project = _match_project_by_words(cleaned, projects)
    estimated_minutes = _extract_minutes(cleaned) or 60
    importance = 3
    matched_goal = matched_project.parent_goal if matched_project else None
    if matched_goal and matched_goal.category in {models.GoalCategory.monthly, models.GoalCategory.quarterly}:
        importance = 4
    if matched_goal and matched_goal.category == models.GoalCategory.five_year:
        importance = 5
    return {
        "corrected_text": cleaned[:220],
        "project_id": matched_project.id if matched_project else None,
        "estimated_minutes": estimated_minutes,
        "importance": importance,
    }


def _match_project_by_words(text: str, projects: list[models.Project]) -> models.Project | None:
    words = _meaningful_words(text)
    best_project = None
    best_score = 0
    tied = False
    for project in projects:
        project_words = _meaningful_words(f"{project.name} {project.description or ''}")
        goal_words = _meaningful_words(
            f"{project.parent_goal.title} {project.parent_goal.description or ''}"
            if project.parent_goal
            else ""
        )
        score = len(words & project_words) * 2 + len(words & goal_words)
        if score > best_score:
            best_score = score
            best_project = project
            tied = False
        elif score > 0 and score == best_score:
            tied = True
    return best_project if best_score > 0 and not tied else None


def _meaningful_words(text: str) -> set[str]:
    return {
        word.strip(".,:;!?()[]").lower()
        for word in text.split()
        if len(word.strip(".,:;!?()[]")) > 3
    }


def _extract_minutes(text: str) -> int | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b", text, re.IGNORECASE)
    if match:
        return bounded_int(float(match.group(1)), 5, 480, 60)
    match = re.search(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b", text, re.IGNORECASE)
    if match:
        return bounded_int(float(match.group(1)) * 60, 5, 480, 60)
    return None


def _extract_progress_delta(text: str, goal: models.Goal) -> float:
    if goal.unit and "hour" in goal.unit.lower():
        hour_match = re.search(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b", text, re.IGNORECASE)
        if hour_match:
            return float(hour_match.group(1))
        minute_match = re.search(r"(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b", text, re.IGNORECASE)
        if minute_match:
            return round(float(minute_match.group(1)) / 60, 2)
    number_match = re.search(r"(\d+(?:\.\d+)?)", text)
    return float(number_match.group(1)) if number_match else 0


def _fallback_goal_next_actions(goals: list[models.Goal], active_tasks: list[models.Task]) -> list[dict]:
    actions = [
        {
            "title": task.title,
            "related_goal": ", ".join(goal.title for goal in task_linked_goals(task)) or "General",
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


def _fallback_captain_compass(
    project_timelines: list[dict],
    context_days: int,
) -> dict:
    entries = [entry for project in project_timelines for entry in project["timeline"]]
    activity_count = len(entries)
    completion_count = sum(entry["kind"] in {"completion_log", "completed_task"} for entry in entries)
    focused_minutes = sum(entry.get("minutes", 0) for entry in entries if entry["kind"] == "pomodoro_session")
    aligned_entries = sum(
        project["linked_goal"] is not None or entry.get("goal_id") is not None
        for project in project_timelines
        for entry in project["timeline"]
    )
    activity_days = {entry["occurred_at"][:10] for entry in entries}
    speed = min(10, max(1, 3 + activity_count // 4))
    direction = min(10, max(1, 4 + (aligned_entries * 4 // max(activity_count, 1))))
    consistency = min(10, max(1, 3 + len(activity_days)))
    overall = round((speed + direction + consistency) / 3)
    if activity_count == 0:
        status = "stalled"
    elif direction <= 5:
        status = "drifting"
    elif speed >= 9 and direction < 7:
        status = "overextended"
    else:
        status = "on_track"
    return {
        "speed_rating": speed,
        "direction_rating": direction,
        "consistency_rating": consistency,
        "overall_rating": overall,
        "status": status,
        "summary": (
            f"Current evidence shows {activity_count} project timeline entries in the last {context_days} days, "
            f"including {completion_count} completions and {focused_minutes} focused minutes."
        ),
        "advice": "Keep project timeline activity tied to the purpose and direction recorded in your four goal horizons.",
        "model": ai_service.resolve_ai_model(user_id=None, feature="captain_compass"),
        "refreshed_at": datetime.now(timezone.utc),
        "context_days": context_days,
    }


def _captain_compass_goals_by_horizon(
    goals: list[models.Goal],
    projects: list[models.Project],
    completion_logs: list[models.CompletedGoalLog],
    cutoff: datetime,
) -> dict[str, list[dict]]:
    projects_by_goal: dict[str, list[models.Project]] = {}
    for project in projects:
        goal_id = project.parent_goal.id if project.parent_goal else project.goal_id
        if goal_id:
            projects_by_goal.setdefault(goal_id, []).append(project)

    completions_by_goal: dict[str, list[models.CompletedGoalLog]] = {}
    for completion in completion_logs:
        goal_id = completion.goal_id
        if goal_id is None and completion.project_id:
            project = next((item for item in projects if item.id == completion.project_id), None)
            goal_id = (
                project.parent_goal.id
                if project and project.parent_goal
                else project.goal_id if project else None
            )
        if goal_id:
            completions_by_goal.setdefault(goal_id, []).append(completion)

    result: dict[str, list[dict]] = {}
    for category in models.GoalCategory:
        category_goals = []
        for goal in goals:
            if goal.category != category:
                continue
            events = [
                {
                    "kind": "goal_established",
                    "occurred_at": as_utc(goal.created_at).isoformat(),
                    "title": "Goal established",
                }
            ]
            for project in projects_by_goal.get(goal.id, []):
                events.append(
                    {
                        "kind": "project_attached",
                        "occurred_at": as_utc(project.created_at).isoformat(),
                        "project_id": project.id,
                        "project_name": project.name,
                        "project_description": project.description,
                        "project_type": project.type.value,
                    }
                )
            events.extend(
                {
                    "kind": "completion",
                    "occurred_at": as_utc(completion.created_at).isoformat(),
                    "title": completion.title,
                    "project_id": completion.project_id,
                }
                for completion in completions_by_goal.get(goal.id, [])
            )
            events.sort(key=lambda entry: entry["occurred_at"])
            recent_events = [
                event for event in events if _is_at_or_after_iso(event["occurred_at"], cutoff)
            ]
            older_events = [
                event for event in events if not _is_at_or_after_iso(event["occurred_at"], cutoff)
            ]
            structural_events = [event for event in older_events if event["kind"] != "completion"]
            older_completions = [event for event in older_events if event["kind"] == "completion"]
            background_events = sorted(
                [*structural_events, *older_completions[-10:]],
                key=lambda entry: entry["occurred_at"],
            )
            category_goals.append(
                {
                    "goal_id": goal.id,
                    "title": goal.title,
                    "why": goal.description,
                    "target_value": goal.target_value,
                    "current_value": goal.current_value,
                    "unit": goal.unit,
                    "progress_percentage": goal.progress_percentage,
                    "recent_events": recent_events,
                    "background_events": background_events,
                }
            )
        result[category.value] = category_goals
    return result


def _captain_compass_project_timelines(
    projects: list[models.Project],
    completion_logs: list[models.CompletedGoalLog],
    period_start: datetime,
    period_end: datetime,
) -> list[dict]:
    logs_by_project: dict[str, list[models.CompletedGoalLog]] = {}
    logged_task_ids = set()
    for completion in completion_logs:
        if completion.project_id and _is_in_period(completion.created_at, period_start, period_end):
            logs_by_project.setdefault(completion.project_id, []).append(completion)
        if completion.task_id:
            logged_task_ids.add(completion.task_id)

    project_timelines = []
    for project in projects:
        timeline = [
            {
                "kind": "pomodoro_session",
                "occurred_at": as_utc(session.completed_at).isoformat(),
                "minutes": session.minutes,
                "description": session.description,
            }
            for session in project.pomodoro_sessions
            if _is_in_period(session.completed_at, period_start, period_end)
        ]
        timeline.extend(
            {
                "kind": "completion_log",
                "occurred_at": as_utc(completion.created_at).isoformat(),
                "title": completion.title,
                "task_id": completion.task_id,
                "goal_id": completion.goal_id,
            }
            for completion in logs_by_project.get(project.id, [])
        )
        timeline.extend(
            {
                "kind": "completed_task",
                "occurred_at": as_utc(task.completed_at).isoformat(),
                "task_id": task.id,
                "title": task.title,
                "description": task.description,
                "minutes": round(task.time_spent_hours * 60),
            }
            for task in project.tasks
            if (
                task.status == models.TaskStatus.done
                and task.id not in logged_task_ids
                and task.completed_at is not None
                and _is_in_period(task.completed_at, period_start, period_end)
            )
        )
        timeline.sort(key=lambda entry: entry["occurred_at"])
        project_timelines.append(
            {
                "project_id": project.id,
                "project_name": project.name,
                "project_description": project.description,
                "project_type": project.type.value,
                "linked_goal": _captain_compass_linked_goal(project),
                "timeline": timeline,
            }
        )
    return project_timelines


def _captain_compass_active_commitments(
    projects: list[models.Project],
    now: datetime,
) -> dict:
    commitments = []
    for project in projects:
        active_tasks = []
        for task in project.tasks:
            if task.status == models.TaskStatus.done:
                continue
            deadline = as_utc(task.deadline) if task.deadline is not None else None
            active_tasks.append(
                {
                    "task_id": task.id,
                    "title": task.title,
                    "description": task.description,
                    "status": task.status.value,
                    "priority": task.priority.value,
                    "importance": task.importance_rating,
                    "estimated_hours": task.eta_hours,
                    "time_spent_hours": task.time_spent_hours,
                    "start_date": as_utc(task.start_date).isoformat() if task.start_date else None,
                    "deadline": deadline.isoformat() if deadline else None,
                    "overdue": deadline < now if deadline else False,
                }
            )
        if not active_tasks:
            continue
        active_tasks.sort(
            key=lambda task: (
                not task["overdue"],
                task["deadline"] is None,
                task["deadline"] or "",
                -task["importance"],
            )
        )
        commitments.append(
            {
                "project_id": project.id,
                "project_name": project.name,
                "project_description": project.description,
                "linked_goal": _captain_compass_linked_goal(project),
                "active_tasks": active_tasks,
            }
        )
    active_tasks = [
        task
        for commitment in commitments
        for task in commitment["active_tasks"]
    ]
    return {
        "summary": {
            "active_projects": len(commitments),
            "active_tasks": len(active_tasks),
            "overdue_tasks": sum(task["overdue"] for task in active_tasks),
            "estimated_hours": round(sum(task["estimated_hours"] for task in active_tasks), 2),
            "time_spent_hours": round(sum(task["time_spent_hours"] for task in active_tasks), 2),
        },
        "projects": commitments,
    }


def _captain_compass_period_metrics(
    project_timelines: list[dict],
    timezone_offset_minutes: int,
) -> dict:
    entries = [entry for project in project_timelines for entry in project["timeline"]]
    activity_dates = sorted(
        {
            _captain_compass_local_date(entry["occurred_at"], timezone_offset_minutes)
            for entry in entries
        }
    )
    linked_entries = [
        entry
        for project in project_timelines
        for entry in project["timeline"]
        if project["linked_goal"] is not None or entry.get("goal_id") is not None
    ]
    activity_by_goal: dict[str, dict] = {}
    for project in project_timelines:
        linked_goal = project["linked_goal"]
        if linked_goal is not None:
            goal_metrics = activity_by_goal.setdefault(
                linked_goal["goal_id"],
                {
                    "goal_id": linked_goal["goal_id"],
                    "category": linked_goal["category"],
                    "title": linked_goal["title"],
                    "activity_entries": 0,
                    "focused_minutes": 0,
                },
            )
            goal_metrics["activity_entries"] += len(project["timeline"])
            goal_metrics["focused_minutes"] += sum(
                entry.get("minutes", 0)
                for entry in project["timeline"]
                if entry["kind"] == "pomodoro_session"
            )
        for entry in project["timeline"]:
            goal_id = entry.get("goal_id")
            if goal_id and (linked_goal is None or goal_id != linked_goal["goal_id"]):
                goal_metrics = activity_by_goal.setdefault(
                    goal_id,
                    {
                        "goal_id": goal_id,
                        "category": None,
                        "title": None,
                        "activity_entries": 0,
                        "focused_minutes": 0,
                    },
                )
                goal_metrics["activity_entries"] += 1
                goal_metrics["focused_minutes"] += entry.get("minutes", 0)
    return {
        "activity_entries": len(entries),
        "activity_days": len(activity_dates),
        "active_local_dates": activity_dates,
        "pomodoro_sessions": sum(entry["kind"] == "pomodoro_session" for entry in entries),
        "focused_minutes": sum(
            entry.get("minutes", 0) for entry in entries if entry["kind"] == "pomodoro_session"
        ),
        "completion_logs": sum(entry["kind"] == "completion_log" for entry in entries),
        "completed_tasks": sum(entry["kind"] == "completed_task" for entry in entries),
        "linked_activity_entries": len(linked_entries),
        "unlinked_activity_entries": len(entries) - len(linked_entries),
        "activity_by_goal": list(activity_by_goal.values()),
    }


def _captain_compass_data_quality_notes(
    projects: list[models.Project],
    completion_logs: list[models.CompletedGoalLog],
    project_timelines: list[dict],
    period_start: datetime,
    period_end: datetime,
) -> list[dict]:
    notes = []
    projects_with_recent_activity = {
        project["project_id"]
        for project in project_timelines
        if project["timeline"]
    }
    unlinked_projects = [
        project.name
        for project in projects
        if project.parent_goal is None
        and (
            project.id in projects_with_recent_activity
            or any(task.status != models.TaskStatus.done for task in project.tasks)
        )
    ]
    if unlinked_projects:
        notes.append(
            {
                "kind": "unlinked_projects",
                "message": "Activity in these projects has no explicit parent goal; infer alignment cautiously.",
                "projects": unlinked_projects,
            }
        )
    projectless_completions = sum(
        completion.project_id is None
        and _is_in_period(completion.created_at, period_start, period_end)
        for completion in completion_logs
    )
    if projectless_completions:
        notes.append(
            {
                "kind": "projectless_completions",
                "message": "Some completion logs are linked to a goal but not a project.",
                "count": projectless_completions,
            }
        )
    return notes


def _captain_compass_linked_goal(project: models.Project) -> dict | None:
    if project.parent_goal is None:
        return None
    return {
        "goal_id": project.parent_goal.id,
        "category": project.parent_goal.category.value,
        "title": project.parent_goal.title,
    }


def _is_at_or_after_iso(value: str, cutoff: datetime) -> bool:
    return datetime.fromisoformat(value) >= cutoff


def _is_in_period(value: datetime, period_start: datetime, period_end: datetime) -> bool:
    aware_value = as_utc(value)
    return period_start <= aware_value < period_end


def _captain_compass_local_date(value: str, timezone_offset_minutes: int) -> str:
    return (datetime.fromisoformat(value) - timedelta(minutes=timezone_offset_minutes)).date().isoformat()
