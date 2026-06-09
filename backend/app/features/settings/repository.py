from sqlalchemy.orm import Session

from . import models, schemas


def read_preferences(db: Session, *, user_id: str) -> schemas.UserPreferenceRead:
    preferences = db.get(models.UserPreference, user_id)
    if preferences is None:
        return schemas.UserPreferenceRead()
    return schemas.UserPreferenceRead(
        default_project_type=preferences.default_project_type,
        default_task_priority=preferences.default_task_priority,
        default_task_status=preferences.default_task_status,
        default_task_minutes=preferences.default_task_minutes,
        show_week_operations_plan=preferences.show_week_operations_plan,
        show_efficiency_report=preferences.show_efficiency_report,
        show_time_allocation=preferences.show_time_allocation,
        updated_at=preferences.updated_at,
    )


def save_preferences(
    db: Session,
    *,
    user_id: str,
    data: schemas.UserPreferenceUpdate,
) -> schemas.UserPreferenceRead:
    preferences = db.get(models.UserPreference, user_id)
    values = data.model_dump(exclude_unset=True)
    if preferences is None:
        defaults = schemas.UserPreferenceData().model_dump()
        preferences = models.UserPreference(user_id=user_id, **{**defaults, **values})
        db.add(preferences)
    else:
        for field, value in values.items():
            setattr(preferences, field, value)
    db.commit()
    db.refresh(preferences)
    return read_preferences(db, user_id=user_id)
