from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, crud, models, schemas
from ...database import SessionLocal, get_db

router = APIRouter(prefix="/library", tags=["library"])


@router.get("/summary", response_model=schemas.LibrarySummary)
async def get_library_summary(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return crud.get_library_summary(db, current_user)


@router.get("/books", response_model=list[schemas.BookRead])
async def list_books(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return crud.list_books(db, current_user)


@router.post("/books", response_model=schemas.BookRead, status_code=status.HTTP_201_CREATED)
async def create_book(
    book: schemas.BookCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_book = crud.create_book(db, book, current_user)
    background_tasks.add_task(enrich_book_in_background, db_book.id)
    return db_book


@router.put("/books/{book_id}", response_model=schemas.BookRead)
async def update_book(
    book_id: str,
    book: schemas.BookUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_book = crud.update_book(db, book_id, book, current_user)
    if db_book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return db_book


@router.put("/chapters/{chapter_id}", response_model=schemas.ChapterRead)
async def update_chapter(
    chapter_id: str,
    chapter: schemas.ChapterUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_chapter = crud.update_chapter(db, chapter_id, chapter, current_user)
    if db_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")
    return db_chapter


@router.post("/books/{book_id}/chapters", response_model=schemas.ChapterRead, status_code=status.HTTP_201_CREATED)
async def create_chapter(
    book_id: str,
    chapter: schemas.ChapterCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_chapter = crud.create_chapter(db, book_id, chapter, current_user)
    if db_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return db_chapter


@router.post("/books/{book_id}/chapters/regenerate", status_code=status.HTTP_202_ACCEPTED)
async def regenerate_chapters(
    book_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if crud.get_book(db, book_id, current_user) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    background_tasks.add_task(enrich_book_in_background, book_id, True)
    return {"status": "queued"}


@router.delete("/books/{book_id}/chapters", status_code=status.HTTP_204_NO_CONTENT)
async def delete_book_chapters(
    book_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not crud.delete_book_chapters(db, book_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")


@router.delete("/chapters/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chapter(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not crud.delete_chapter(db, chapter_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")


@router.post("/reading-logs", response_model=schemas.ReadingLogRead, status_code=status.HTTP_201_CREATED)
async def create_reading_log(
    reading_log: schemas.ReadingLogCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if crud.get_book(db, reading_log.book_id, current_user) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    db_log = crud.create_reading_log(db, reading_log, current_user)
    if db_log is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reading log")
    return db_log


@router.get("/recommendations", response_model=list[schemas.SuggestedBook])
def suggest_books(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return crud.suggest_books(db, current_user)


@router.get("/next-reading", response_model=list[schemas.OwnedBookRecommendation])
def suggest_next_owned_books(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return crud.suggest_next_owned_books(db, current_user)


def enrich_book_in_background(book_id: str, replace_chapters: bool = False) -> None:
    db = SessionLocal()
    try:
        crud.enrich_book_metadata(db, book_id, replace_chapters=replace_chapters)
    finally:
        db.close()
