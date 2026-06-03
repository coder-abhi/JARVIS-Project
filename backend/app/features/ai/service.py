import os


def ai_status() -> dict[str, str | bool]:
    has_api_key = bool(os.getenv("OPENAI_API_KEY"))
    return {
        "connected": has_api_key,
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "message": "OpenAI API key is configured." if has_api_key else "OPENAI_API_KEY is not configured.",
    }
