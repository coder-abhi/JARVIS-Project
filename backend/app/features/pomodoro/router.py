from fastapi import APIRouter

router = APIRouter(prefix="/pomodoro", tags=["pomodoro"])


@router.get("/status")
async def pomodoro_status():
    return {
        "status": "ok",
        "storage": "Timer state is kept in the desktop client; completed focus logs are persisted through project session endpoints.",
    }
