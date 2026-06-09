import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class ProjectType(str, enum.Enum):
    continuous = "continuous"
    fixed = "fixed"


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class TaskPriority(str, enum.Enum):
    high = "high"
    medium = "medium"
    low = "low"


class GoalCategory(str, enum.Enum):
    monthly = "monthly"
    quarterly = "quarterly"
    yearly = "yearly"
    five_year = "five_year"


class BookStatus(str, enum.Enum):
    yet_to_start = "yet_to_start"
    reading = "reading"
    read = "read"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


goal_projects = Table(
    "goal_projects",
    Base.metadata,
    Column("goal_id", ForeignKey("goals.id"), primary_key=True),
    Column("project_id", ForeignKey("projects.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(220), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    projects: Mapped[list["Project"]] = relationship(back_populates="user")
    books: Mapped[list["Book"]] = relationship(back_populates="user")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user")
    completed_goal_logs: Mapped[list["CompletedGoalLog"]] = relationship(back_populates="user")
    documents: Mapped[list["UserDocument"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserDocument(Base):
    __tablename__ = "user_documents"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_documents_user_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="documents")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    goal_id: Mapped[str | None] = mapped_column(ForeignKey("goals.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[ProjectType] = mapped_column(Enum(ProjectType), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User | None] = relationship(back_populates="projects")
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Task.created_at",
    )
    pomodoro_sessions: Mapped[list["PomodoroSessionLog"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="PomodoroSessionLog.completed_at.desc()",
    )
    parent_goal: Mapped["Goal | None"] = relationship(back_populates="linked_projects")

    @property
    def linked_goals(self) -> list["Goal"]:
        return [self.parent_goal] if self.parent_goal is not None else []

    @linked_goals.setter
    def linked_goals(self, goals: list["Goal"]) -> None:
        if len(goals) > 1:
            raise ValueError("A project can have at most one parent goal")
        self.parent_goal = goals[0] if goals else None


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.todo, nullable=False)
    priority: Mapped[TaskPriority] = mapped_column(Enum(TaskPriority), default=TaskPriority.medium, nullable=False)
    importance_rating: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    eta_hours: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    time_spent_hours: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    project: Mapped[Project] = relationship(back_populates="tasks")


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    category: Mapped[GoalCategory] = mapped_column(Enum(GoalCategory), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(260), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_value: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    personality_insight: Mapped[str | None] = mapped_column(Text, nullable=True)
    personality_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="goals")
    completed_logs: Mapped[list["CompletedGoalLog"]] = relationship(back_populates="goal")
    linked_projects: Mapped[list[Project]] = relationship(
        back_populates="parent_goal",
        order_by="Project.created_at",
    )

    @property
    def measurable(self) -> bool:
        return self.target_value is not None and self.target_value > 0

    @property
    def progress_percentage(self) -> int | None:
        if not self.measurable or self.target_value is None:
            return None
        return min(round((self.current_value / self.target_value) * 100), 100)


class CompletedGoalLog(Base):
    __tablename__ = "completed_goal_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    goal_id: Mapped[str | None] = mapped_column(ForeignKey("goals.id"), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(260), nullable=False)
    goal_label: Mapped[str] = mapped_column(String(80), default="General", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="completed_goal_logs")
    goal: Mapped[Goal | None] = relationship(back_populates="completed_logs")


class PomodoroSessionLog(Base):
    __tablename__ = "pomodoro_session_logs"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(20), default="focus", nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    project: Mapped[Project] = relationship(back_populates="pomodoro_sessions")


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    author: Mapped[str | None] = mapped_column(String(160), nullable=True)
    area: Mapped[str] = mapped_column(String(80), default="General", nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="General", nullable=False)
    total_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_page: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[BookStatus] = mapped_column(Enum(BookStatus), default=BookStatus.yet_to_start, nullable=False)
    liked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchase_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchase_price: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User | None] = relationship(back_populates="books")
    chapters: Mapped[list["BookChapter"]] = relationship(
        back_populates="book",
        cascade="all, delete-orphan",
        order_by="BookChapter.position",
    )
    reading_logs: Mapped[list["ReadingLog"]] = relationship(
        back_populates="book",
        cascade="all, delete-orphan",
        order_by="ReadingLog.read_at.desc()",
    )

    @property
    def pages_read(self) -> int:
        return sum(log.pages_read for log in self.reading_logs)

    @property
    def pages_remaining(self) -> int:
        return max(self.total_pages - self.pages_read, 0)


class BookChapter(Base):
    __tablename__ = "book_chapters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    is_liked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resonated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    book: Mapped[Book] = relationship(back_populates="chapters")


class ReadingLog(Base):
    __tablename__ = "reading_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id"), nullable=False, index=True)
    read_on: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    start_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pages_read: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    book: Mapped[Book] = relationship(back_populates="reading_logs")
