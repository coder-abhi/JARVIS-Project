from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ... import auth, models as root_models
from ...database import get_db
from . import schemas, service

router = APIRouter(prefix="/money", tags=["money"])


@router.get("", response_model=schemas.WealthData)
async def get_wealth_data(
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    return service.get_wealth_data(db, user_id=current_user.id)


@router.put("", response_model=schemas.WealthData)
async def put_wealth_data(
    data: schemas.WealthData,
    db: Session = Depends(get_db),
    current_user: root_models.User = Depends(auth.get_current_user),
):
    try:
        return service.save_wealth_data(db, user_id=current_user.id, data=data)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def _save_resource(db, current_user, resource, data, *, create_only: bool):
    try:
        return service.save_resource(
            db,
            user_id=current_user.id,
            resource=resource,
            data=data,
            create_only=create_only,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        error_status = status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_CONTENT
        raise HTTPException(status_code=error_status, detail=str(exc)) from exc


@router.post("/accounts", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_account(data: schemas.WealthAccountData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "accounts", data, create_only=True)


@router.put("/accounts/{entry_id}", response_model=schemas.WealthData)
async def update_account(entry_id: str, data: schemas.WealthAccountData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "accounts", data, create_only=False)


@router.post("/categories", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_category(data: schemas.WealthCategoryData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "categories", data, create_only=True)


@router.put("/categories/{entry_id}", response_model=schemas.WealthData)
async def update_category(entry_id: str, data: schemas.WealthCategoryData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "categories", data, create_only=False)


@router.post("/cards", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_card(data: schemas.WealthCreditCardData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "cards", data, create_only=True)


@router.put("/cards/{entry_id}", response_model=schemas.WealthData)
async def update_card(entry_id: str, data: schemas.WealthCreditCardData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "cards", data, create_only=False)


@router.post("/transactions", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_transaction(data: schemas.WealthTransactionData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "transactions", data, create_only=True)


@router.put("/transactions/{entry_id}", response_model=schemas.WealthData)
async def update_transaction(entry_id: str, data: schemas.WealthTransactionData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "transactions", data, create_only=False)


@router.post("/loans", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_loan(data: schemas.WealthLoanData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "loans", data, create_only=True)


@router.put("/loans/{entry_id}", response_model=schemas.WealthData)
async def update_loan(entry_id: str, data: schemas.WealthLoanData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "loans", data, create_only=False)


@router.post("/investments", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_investment(data: schemas.WealthInvestmentData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "investments", data, create_only=True)


@router.put("/investments/{entry_id}", response_model=schemas.WealthData)
async def update_investment(entry_id: str, data: schemas.WealthInvestmentData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "investments", data, create_only=False)


@router.post("/saving-goals", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_saving_goal(data: schemas.WealthSavingGoalData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "goals", data, create_only=True)


@router.put("/saving-goals/{entry_id}", response_model=schemas.WealthData)
async def update_saving_goal(entry_id: str, data: schemas.WealthSavingGoalData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "goals", data, create_only=False)


@router.post("/expected-incomes", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_expected_income(data: schemas.WealthExpectedIncomeData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "incomes", data, create_only=True)


@router.put("/expected-incomes/{entry_id}", response_model=schemas.WealthData)
async def update_expected_income(entry_id: str, data: schemas.WealthExpectedIncomeData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "incomes", data, create_only=False)


@router.post("/expected-bills", response_model=schemas.WealthData, status_code=status.HTTP_201_CREATED)
async def create_expected_bill(data: schemas.WealthExpectedBillData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    return _save_resource(db, current_user, "bills", data, create_only=True)


@router.put("/expected-bills/{entry_id}", response_model=schemas.WealthData)
async def update_expected_bill(entry_id: str, data: schemas.WealthExpectedBillData, db: Session = Depends(get_db), current_user: root_models.User = Depends(auth.get_current_user)):
    _require_matching_id(entry_id, data.id)
    return _save_resource(db, current_user, "bills", data, create_only=False)


def _require_matching_id(path_id: str, body_id: str) -> None:
    if path_id != body_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path id and body id must match")
