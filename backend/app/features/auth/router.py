from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, models, schemas
from ...database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=schemas.AuthRead, status_code=status.HTTP_201_CREATED)
async def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = auth.create_user(db, user)
    return schemas.AuthRead(access_token=auth.create_access_token(db_user.id), user=db_user)


@router.post("/login", response_model=schemas.AuthRead)
async def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = auth.authenticate_user(db, credentials.username, credentials.password)
    if db_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    return schemas.AuthRead(access_token=auth.create_access_token(db_user.id), user=db_user)


@router.get("/me", response_model=schemas.UserRead)
async def me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user
