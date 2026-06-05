from datetime import datetime

from pydantic import BaseModel


class AiFeatureCost(BaseModel):
    feature: str
    label: str
    cost_cents: float
    share_percentage: float
    requests: int
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    total_tokens: int
    average_cost_cents: float


class AiDailyCost(BaseModel):
    date: str
    cost_cents: float
    requests: int
    total_tokens: int


class AiRecentRequest(BaseModel):
    id: str
    feature: str
    label: str
    model: str
    cost_cents: float
    total_tokens: int
    status: str
    latency_ms: int
    pricing_available: bool
    created_at: datetime


class AiCostSummary(BaseModel):
    period_days: int | None
    period_start: datetime | None
    total_cost_cents: float
    today_cost_cents: float
    month_cost_cents: float
    total_requests: int
    successful_requests: int
    failed_requests: int
    unpriced_requests: int
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    total_tokens: int
    average_cost_cents: float
    by_feature: list[AiFeatureCost]
    daily: list[AiDailyCost]
    recent_requests: list[AiRecentRequest]


class AiFeatureSettingRead(BaseModel):
    feature: str
    label: str
    description: str
    enabled: bool


class AiFeatureSettingUpdate(BaseModel):
    enabled: bool
