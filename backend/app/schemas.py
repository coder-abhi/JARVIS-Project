from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import BookStatus, GoalCategory, ProjectType, TaskPriority, TaskStatus


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    created_at: datetime


class AuthRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    type: ProjectType


class LinkedGoalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    category: GoalCategory
    title: str


class LinkedProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    type: ProjectType


class ProjectCreate(ProjectBase):
    goal_id: str | None = None
    linked_goal_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_goal_parent(self):
        linked_goal_ids = list(dict.fromkeys(self.linked_goal_ids))
        if len(linked_goal_ids) > 1:
            raise ValueError("A project can have at most one parent goal")
        if self.goal_id and linked_goal_ids and self.goal_id != linked_goal_ids[0]:
            raise ValueError("goal_id and linked_goal_ids must identify the same goal")
        self.goal_id = self.goal_id or (linked_goal_ids[0] if linked_goal_ids else None)
        return self


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    type: ProjectType | None = None
    goal_id: str | None = None


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    goal_id: str | None = None
    linked_goals: list[LinkedGoalRead] = Field(default_factory=list)


class ProjectSummary(ProjectRead):
    total_tasks: int
    completed_tasks: int
    in_progress_tasks: int
    overdue_tasks: int
    eta_hours: float
    time_spent_hours: float
    completed_hours: float
    remaining_hours: float
    next_deadline: datetime | None


class TaskBase(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=220)
    description: str | None = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.medium
    importance_rating: int = Field(default=3, ge=1, le=5)
    eta_hours: float = Field(default=0, ge=0)
    time_spent_hours: float = Field(default=0, ge=0)
    start_date: datetime | None = None
    deadline: datetime | None = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=220)
    description: str | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    importance_rating: int | None = Field(default=None, ge=1, le=5)
    eta_hours: float | None = Field(default=None, ge=0)
    time_spent_hours: float | None = Field(default=None, ge=0)
    start_date: datetime | None = None
    deadline: datetime | None = None


class TaskRead(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime


class PomodoroAssignmentProject(BaseModel):
    project_id: str


class PomodoroAssignmentRequest(BaseModel):
    note: str = Field(default="", max_length=4000)
    project_ids: list[str] = Field(default_factory=list)


class PomodoroAssignmentRead(BaseModel):
    assigned: bool
    confidence: float
    project_id: str | None = None
    task_id: str | None = None
    reason: str | None = None


class PomodoroSessionLogBase(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    project_id: str
    mode: str = Field(default="focus", max_length=20)
    minutes: int = Field(ge=1)
    description: str | None = Field(default=None, max_length=4000)
    started_at: datetime
    completed_at: datetime


class PomodoroSessionLogCreate(PomodoroSessionLogBase):
    pass


class PomodoroSessionLogRead(PomodoroSessionLogBase):
    model_config = ConfigDict(from_attributes=True)

    created_at: datetime


class GoalBase(BaseModel):
    category: GoalCategory
    title: str = Field(min_length=1, max_length=260)
    description: str | None = Field(default=None, max_length=4000)
    target_value: float | None = Field(default=None, ge=0)
    current_value: float = Field(default=0, ge=0)
    unit: str | None = Field(default=None, max_length=40)


class GoalCreate(GoalBase):
    linked_project_ids: list[str] = Field(default_factory=list)


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=260)
    description: str | None = Field(default=None, max_length=4000)
    target_value: float | None = Field(default=None, ge=0)
    current_value: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=40)
    linked_project_ids: list[str] | None = None


class GoalRead(GoalBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    measurable: bool
    progress_percentage: int | None
    linked_projects: list[LinkedProjectRead] = Field(default_factory=list)


class GoalTaskRead(BaseModel):
    id: str
    project_id: str
    project_name: str
    linked_goals: list[LinkedGoalRead] = Field(default_factory=list)
    title: str
    status: TaskStatus
    priority: TaskPriority
    importance_rating: int
    eta_hours: float
    time_required_minutes: int
    created_at: datetime


class CompletedGoalLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    goal_id: str | None
    project_id: str | None
    task_id: str | None
    title: str
    goal_label: str
    created_at: datetime


class PersonalityInsightRead(BaseModel):
    text: str | None = None
    refreshed_at: datetime | None = None


class GoalNextActionRead(BaseModel):
    title: str
    related_goal: str
    importance: int = Field(ge=1, le=5)
    urgency: int = Field(ge=1, le=5)


class CaptainCompassRead(BaseModel):
    speed_rating: int = Field(ge=1, le=10)
    direction_rating: int = Field(ge=1, le=10)
    consistency_rating: int = Field(ge=1, le=10)
    overall_rating: int = Field(ge=1, le=10)
    status: str
    summary: str
    advice: str
    model: str
    refreshed_at: datetime


class GoalsOverview(BaseModel):
    goals: list[GoalRead]
    active_tasks: list[GoalTaskRead]
    recent_completed_tasks: list[CompletedGoalLogRead]
    personality_insight: PersonalityInsightRead


class GoalLogRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class GoalLogResponse(BaseModel):
    mode: str
    corrected_text: str
    related_goal: str
    task: GoalTaskRead | None = None
    completion: CompletedGoalLogRead | None = None


class ChapterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    book_id: str
    title: str
    position: int
    resonated: bool


class BookBase(BaseModel):
    title: str = Field(min_length=1, max_length=220)
    author: str | None = Field(default=None, max_length=160)
    category: str = Field(default="", max_length=80)
    total_pages: int = Field(default=0, ge=0)
    status: BookStatus = BookStatus.yet_to_start
    liked: bool = False
    rating: int | None = Field(default=None, ge=1, le=10)
    purchase_date: datetime | None = None
    purchase_price: float | None = Field(default=None, ge=0)


class BookCreate(BookBase):
    pass


class BookUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=220)
    author: str | None = Field(default=None, max_length=160)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    total_pages: int | None = Field(default=None, ge=0)
    status: BookStatus | None = None
    liked: bool | None = None
    rating: int | None = Field(default=None, ge=1, le=10)
    purchase_date: datetime | None = None
    purchase_price: float | None = Field(default=None, ge=0)


class BookRead(BookBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    current_page: int
    pages_read: int
    pages_remaining: int
    chapters: list[ChapterRead] = []


class ChapterUpdate(BaseModel):
    resonated: bool


class ChapterCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)


class ReadingLogCreate(BaseModel):
    book_id: str
    pages_read: int | None = Field(default=None, ge=1)
    start_page: int | None = Field(default=None, ge=1)
    end_page: int | None = Field(default=None, ge=1)
    read_at: datetime | None = None
    note: str | None = None

    @model_validator(mode="after")
    def validate_page_range(self):
        has_range = self.start_page is not None or self.end_page is not None
        if has_range and (self.start_page is None or self.end_page is None):
            raise ValueError("Start and end page are both required")
        if self.start_page is not None and self.end_page is not None and self.end_page < self.start_page:
            raise ValueError("End page must be greater than or equal to start page")
        if self.pages_read is None and not has_range:
            raise ValueError("Pages read or a page range is required")
        return self


class ReadingLogRead(ReadingLogCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    pages_read: int
    read_at: datetime


class LibrarySummary(BaseModel):
    total_books: int
    read_books: int
    liked_books: int
    yet_to_start_books: int
    reading_books: int
    pages_today: int
    pages_this_week: int
    first_reading_date: date | None
    current_categories: list[str]
    daywise_pages: list[dict[str, int | str]]
    daily_pages: list[dict[str, int | str]]
    monthly_pages: list[dict[str, int | str]]
    categories: list[dict[str, int | str]]


class SuggestedBook(BaseModel):
    title: str
    author: str | None = None
    category: str
    reason: str


class OwnedBookRecommendation(BaseModel):
    book_id: str
    title: str
    author: str | None = None
    category: str
    status: BookStatus
    reason: str
