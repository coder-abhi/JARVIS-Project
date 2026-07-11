from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ... import models


def get_book(db: Session, book_id: str, user: models.User | None = None) -> models.Book | None:
    query = (
        select(models.Book)
        .where(models.Book.id == book_id)
        .options(selectinload(models.Book.chapters), selectinload(models.Book.reading_logs))
    )
    if user is not None:
        query = query.where(models.Book.user_id == user.id)
    return db.scalar(query)


def list_books(db: Session, user: models.User) -> list[models.Book]:
    query = (
        select(models.Book)
        .where(models.Book.user_id == user.id)
        .options(selectinload(models.Book.chapters), selectinload(models.Book.reading_logs))
        .order_by(models.Book.purchase_date.desc().nullslast(), models.Book.created_at.desc())
    )
    return list(db.scalars(query))


def list_reading_logs(db: Session, user: models.User) -> list[models.ReadingLog]:
    return list(
        db.scalars(
            select(models.ReadingLog)
            .join(models.Book)
            .where(models.Book.user_id == user.id)
            .order_by(models.ReadingLog.read_at.desc())
        )
    )
