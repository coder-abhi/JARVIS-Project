import { useEffect, useMemo, useState } from "react";

import { getAiCosts, type AiCostSummary } from "../api";
import "./AiCostPage.css";

type CostRange = 7 | 30 | 90 | 0;
type CostView = "overview" | "feature";

const rangeOptions: { value: CostRange; label: string }[] = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 0, label: "All" },
];

export default function AiCostPage() {
  const [summary, setSummary] = useState<AiCostSummary | null>(null);
  const [range, setRange] = useState<CostRange>(30);
  const [view, setView] = useState<CostView>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    getAiCosts(range)
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [range, refreshKey]);

  const maxDailyCost = useMemo(
    () => Math.max(...(summary?.daily.map((day) => day.cost_cents) ?? []), 0),
    [summary],
  );
  const rangeLabel = range === 0 ? "All recorded usage" : `Last ${range} days`;
  const hasUsage = Boolean(summary?.total_requests);

  return (
    <main className="ops-screen ai-cost-screen">
      <header className="ops-header">
        <div>
          <p className="ops-kicker">AI FINANCIAL TELEMETRY</p>
          <h1>AI Cost</h1>
          <p className="ops-subtitle">Local OpenAI token accounting, request health, and feature-wise spend.</p>
        </div>
        <div className="ai-cost-header-actions">
          <div className="ops-segment ai-cost-segment" aria-label="Cost period">
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={range === option.value ? "active" : undefined}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="ops-button primary" onClick={() => setRefreshKey((value) => value + 1)} disabled={isLoading}>
            {isLoading ? "Scanning" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <p className="ops-alert danger">{error}</p> : null}
      {summary?.unpriced_requests ? (
        <p className="ops-alert danger">
          {summary.unpriced_requests} request{summary.unpriced_requests === 1 ? "" : "s"} use a model without configured pricing and are excluded from cost totals.
        </p>
      ) : null}

      <section className="ai-cost-metrics">
        <CostMetric label={`${rangeLabel} spend`} value={formatCents(summary?.total_cost_cents ?? 0)} signal />
        <CostMetric label="Today" value={formatCents(summary?.today_cost_cents ?? 0)} />
        <CostMetric label="This month" value={formatCents(summary?.month_cost_cents ?? 0)} />
        <CostMetric label="Average request" value={formatCents(summary?.average_cost_cents ?? 0)} />
        <CostMetric label="Requests" value={formatNumber(summary?.total_requests ?? 0)} />
        <CostMetric label="Tokens" value={formatNumber(summary?.total_tokens ?? 0)} />
      </section>

      <div className="ai-cost-view-switch ops-segment" aria-label="Cost view">
        <button type="button" className={view === "overview" ? "active" : undefined} onClick={() => setView("overview")}>
          Overview
        </button>
        <button type="button" className={view === "feature" ? "active" : undefined} onClick={() => setView("feature")}>
          Feature Wise
        </button>
      </div>

      {isLoading && !summary ? <p className="ops-empty">Loading AI cost telemetry...</p> : null}

      {!isLoading && !hasUsage ? (
        <section className="ops-panel ai-cost-empty">
          <p className="ops-kicker">LEDGER ARMED</p>
          <h2>No Recorded Calls</h2>
          <p>New OpenAI requests will appear here with token counts, latency, and estimated cost in cents.</p>
        </section>
      ) : null}

      {summary && hasUsage && view === "overview" ? (
        <section className="ops-grid ai-cost-grid">
          <div className="ops-panel span-8">
            <PanelHeader label="Daily Cost Signal" detail={rangeLabel} />
            <div className="ai-cost-chart" aria-label="Daily AI cost chart">
              {summary.daily.map((day, index) => {
                const height = maxDailyCost > 0 ? Math.max((day.cost_cents / maxDailyCost) * 100, day.cost_cents > 0 ? 4 : 1) : 1;
                const showLabel = summary.daily.length <= 14 || index === 0 || index === summary.daily.length - 1;
                return (
                  <div key={day.date} className="ai-cost-day" title={`${formatDate(day.date)}: ${formatCents(day.cost_cents)} across ${day.requests} requests`}>
                    <span className="ai-cost-bar-value">{day.cost_cents > 0 ? formatCents(day.cost_cents) : ""}</span>
                    <span className="ai-cost-bar-track">
                      <span style={{ height: `${height}%` }} />
                    </span>
                    <small>{showLabel ? shortDate(day.date) : ""}</small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ops-panel span-4">
            <PanelHeader label="Token Profile" detail="Selected period" />
            <div className="ai-token-stack">
              <TokenLine label="Input" value={summary.input_tokens} total={summary.total_tokens} />
              <TokenLine label="Cached input" value={summary.cached_input_tokens} total={summary.total_tokens} />
              <TokenLine label="Output" value={summary.output_tokens} total={summary.total_tokens} />
            </div>
            <div className="ai-request-health">
              <div>
                <span>Successful</span>
                <strong>{summary.successful_requests}</strong>
              </div>
              <div className={summary.failed_requests ? "danger" : undefined}>
                <span>Failed</span>
                <strong>{summary.failed_requests}</strong>
              </div>
            </div>
          </div>

          <div className="ops-panel span-12">
            <PanelHeader label="Feature Cost Distribution" detail={`${summary.by_feature.length} active AI features`} />
            <FeatureBars summary={summary} />
          </div>
        </section>
      ) : null}

      {summary && hasUsage && view === "feature" ? (
        <section className="ops-panel ai-feature-panel">
          <PanelHeader label="Feature-wise Cost" detail={`${rangeLabel} / values in cents`} />
          <div className="ops-table ai-feature-table">
            <div className="ops-row ops-row-head ai-feature-row">
              <span>Feature</span>
              <span>Cost</span>
              <span>Share</span>
              <span>Requests</span>
              <span>Tokens</span>
              <span>Avg / call</span>
            </div>
            {summary.by_feature.map((feature) => (
              <div className="ops-row ai-feature-row" key={feature.feature}>
                <span>
                  <i className="ops-dot" />
                  {feature.label}
                </span>
                <strong>{formatCents(feature.cost_cents)}</strong>
                <span>{formatPercentage(feature.share_percentage)}</span>
                <span>{formatNumber(feature.requests)}</span>
                <span>{formatNumber(feature.total_tokens)}</span>
                <span>{formatCents(feature.average_cost_cents)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {summary && hasUsage ? (
        <section className="ops-panel ai-recent-panel">
          <PanelHeader label="Recent AI Calls" detail="Latest metered requests" />
          <div className="ops-table ai-recent-table">
            <div className="ops-row ops-row-head ai-recent-row">
              <span>Feature</span>
              <span>Model</span>
              <span>Cost</span>
              <span>Tokens</span>
              <span>Latency</span>
              <span>Status</span>
              <span>Time</span>
            </div>
            {summary.recent_requests.map((request) => (
              <div className="ops-row ai-recent-row" key={request.id}>
                <span>{request.label}</span>
                <span className="truncate">{request.model}</span>
                <strong>{request.pricing_available ? formatCents(request.cost_cents) : "UNPRICED"}</strong>
                <span>{formatNumber(request.total_tokens)}</span>
                <span>{formatLatency(request.latency_ms)}</span>
                <span className={request.status === "success" ? "ops-status signal" : "ops-status danger"}>
                  {request.status.replace("_", " ")}
                </span>
                <span>{formatTimestamp(request.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function CostMetric({ label, value, signal = false }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className={signal ? "ai-cost-metric signal" : "ai-cost-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeader({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="ops-panel-head">
      <h2>{label}</h2>
      <span>{detail}</span>
    </div>
  );
}

function FeatureBars({ summary }: { summary: AiCostSummary }) {
  return (
    <div className="ai-feature-bars">
      {summary.by_feature.map((feature) => (
        <div className="ai-feature-bar-row" key={feature.feature}>
          <div>
            <strong>{feature.label}</strong>
            <span>{feature.requests} calls / {formatNumber(feature.total_tokens)} tokens</span>
          </div>
          <span className="ai-feature-track">
            <span style={{ width: `${Math.max(feature.share_percentage, feature.cost_cents > 0 ? 1 : 0)}%` }} />
          </span>
          <strong>{formatCents(feature.cost_cents)}</strong>
        </div>
      ))}
    </div>
  );
}

function TokenLine({ label, value, total }: { label: string; value: number; total: number }) {
  const width = total ? Math.min((value / total) * 100, 100) : 0;
  return (
    <div className="ai-token-line">
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)}</strong>
      </div>
      <span className="ai-token-track">
        <span style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

function formatCents(value: number) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2, maximumFractionDigits: 6 })}¢`;
}

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatPercentage(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatLatency(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
