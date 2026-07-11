from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ... import models, schemas
from ...prompts import (
    BOOK_METADATA_SYSTEM_PROMPT,
    BOOK_METADATA_USER_PROMPT,
    BOOK_RECOMMENDATIONS_SYSTEM_PROMPT,
    BOOK_RECOMMENDATIONS_USER_PROMPT,
    OWNED_BOOK_NEXT_READ_SYSTEM_PROMPT,
    OWNED_BOOK_NEXT_READ_USER_PROMPT,
)
from ...shared.utils import as_aware, as_float, canonical_json, clean_text
from ..ai import service as ai_service
from .repository import get_book, list_books, list_reading_logs

__all__ = [
    "create_book",
    "create_chapter",
    "create_reading_log",
    "delete_book_chapters",
    "delete_chapter",
    "enrich_book_metadata",
    "generate_book_suggestions",
    "generate_next_owned_book_suggestions",
    "get_book",
    "get_library_summary",
    "list_books",
    "list_reading_logs",
    "suggest_books",
    "suggest_next_owned_books",
    "update_book",
    "update_chapter",
]


def create_book(db: Session, book: schemas.BookCreate, user: models.User) -> models.Book:
    book_data = book.model_dump()
    book_data["author"] = clean_text(book.author)
    book_data["category"] = clean_text(book.category) or "Uncategorized"
    book_data["area"] = book_data["category"]
    book_data["purchased_at"] = book_data["purchase_date"]
    book_data["purchase_price"] = book_data["purchase_price"] or 0
    db_book = models.Book(**book_data, user_id=user.id)
    db.add(db_book)
    db.commit()
    db.refresh(db_book)
    return db_book


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
        force_refresh=replace_chapters,
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
                "pages": sum(log.pages_read for log in logs if as_aware(log.read_at).date() == day),
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
                    if as_aware(log.read_at).year == year and as_aware(log.read_at).month == month
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
        pages_today=sum(log.pages_read for log in logs if as_aware(log.read_at).date() == today),
        pages_this_week=sum(log.pages_read for log in logs if as_aware(log.read_at).date() >= week_start),
        first_reading_date=min((as_aware(log.read_at).date() for log in logs), default=None),
        current_categories=active_categories,
        daywise_pages=daywise_pages,
        daily_pages=daily_pages,
        monthly_pages=monthly_pages,
        categories=[{"category": category, "books": count} for category, count in sorted(category_counts.items())],
    )


def suggest_books(db: Session, user: models.User) -> list[schemas.SuggestedBook]:
    books = list_books(db, user)
    suggestions = generate_book_suggestions(books, user_id=user.id, usage_db=db)
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
    force_refresh: bool = False,
) -> dict[str, str | None | list[str]]:
    provided_author = clean_text(author)
    provided_category = clean_text(category)
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
        force_refresh=force_refresh,
    )
    if not data:
        return metadata

    confidence = as_float(data.get("confidence"))
    if data.get("identified") is not True or confidence < 0.82:
        return metadata

    corrected_title = clean_text(data.get("corrected_title"))
    if corrected_title:
        metadata["title"] = corrected_title

    corrected_author = clean_text(data.get("corrected_author"))
    if corrected_author:
        metadata["author"] = corrected_author

    if not provided_category:
        model_category = clean_text(data.get("category"))
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
    force_refresh: bool = False,
) -> dict:
    prompt = f"{BOOK_METADATA_USER_PROMPT} Context: {canonical_json({'title': title, 'author': author, 'category': category})}"
    return ai_service.call_ai_json(
        BOOK_METADATA_SYSTEM_PROMPT,
        prompt,
        max_tokens=1200,
        feature="book_metadata",
        user_id=user_id,
        usage_db=usage_db,
        force_refresh=force_refresh,
    )


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
            "purchase_date": book.purchase_date.isoformat() if book.purchase_date else None,
            "created_at": book.created_at.isoformat(),
        }
        for book in books[:12]
    ]
    prompt = f"{BOOK_RECOMMENDATIONS_USER_PROMPT} History: {canonical_json(recent_context)}"
    data = ai_service.call_ai_json(
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
            "total_pages": book.total_pages,
            "current_page": book.current_page,
            "pages_read": book.pages_read,
            "pages_remaining": book.pages_remaining,
            "purchase_date": book.purchase_date.isoformat() if book.purchase_date else None,
            "created_at": book.created_at.isoformat(),
        }
        for book in books[:30]
    ]
    prompt = f"{OWNED_BOOK_NEXT_READ_USER_PROMPT} Candidates: {canonical_json(candidates)}"
    data = ai_service.call_ai_json(
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
            as_aware(book.purchase_date or book.created_at),
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
