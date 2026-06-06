"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  getCaptainCompass,
  getAiCosts,
  getAiStatus,
  getProjectSummaries,
  logGoalEntry,
  type AiCostSummary,
  type AiStatus,
  type CaptainCompass,
  type CaptainCompassContextDays,
  type ProjectSummary,
} from "@/lib/api";
import {
  getFocusMinutesToday,
  getFocusMomentum,
  readStoredPomodoroLogs,
  type FocusMetricLog,
} from "@/lib/focusMetrics";
import { pomodoroSessionCompletedEvent, pomodoroSessionUpdatedEvent } from "@/lib/pomodoroSession";
import "./DashboardPage.css";

let cachedAiConnectivity: { status: AiStatus | null; reachable: boolean } | null = null;

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [aiCosts, setAiCosts] = useState<AiCostSummary | null>(null);
  const [focusLogs, setFocusLogs] = useState<FocusMetricLog[]>([]);
  const [captainCompass, setCaptainCompass] = useState<CaptainCompass | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compassError, setCompassError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [isAiReachable, setIsAiReachable] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [logText, setLogText] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  const [isLoadingCompass, setIsLoadingCompass] = useState(false);
  const [isRefreshingCompass, setIsRefreshingCompass] = useState(false);
  const [compassContextDays, setCompassContextDays] = useState<CaptainCompassContextDays>(30);
  const [message, setMessage] = useState<string | null>(null);
  const compassRequestId = useRef(0);

  async function loadDashboard() {
    setError(null);
    const [summaries, costs] = await Promise.all([getProjectSummaries(), getAiCosts(0)]);
    setProjects(summaries);
    setAiCosts(costs);
  }

  useEffect(() => {
    loadDashboard()
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const requestId = ++compassRequestId.current;
    setIsLoadingCompass(true);
    setCompassError(null);
    setCaptainCompass(null);
    getCaptainCompass(false, compassContextDays)
      .then((assessment) => {
        if (compassRequestId.current === requestId) setCaptainCompass(assessment);
      })
      .catch((err: Error) => {
        if (compassRequestId.current === requestId) setCompassError(err.message);
      })
      .finally(() => {
        if (compassRequestId.current === requestId) setIsLoadingCompass(false);
      });
  }, [compassContextDays]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    function refreshFocusLogs() {
      setFocusLogs(readStoredPomodoroLogs());
    }

    refreshFocusLogs();
    window.addEventListener("storage", refreshFocusLogs);
    window.addEventListener(pomodoroSessionCompletedEvent, refreshFocusLogs);
    window.addEventListener(pomodoroSessionUpdatedEvent, refreshFocusLogs);
    return () => {
      window.removeEventListener("storage", refreshFocusLogs);
      window.removeEventListener(pomodoroSessionCompletedEvent, refreshFocusLogs);
      window.removeEventListener(pomodoroSessionUpdatedEvent, refreshFocusLogs);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadAiStatus() {
      if (cachedAiConnectivity) {
        setAiStatus(cachedAiConnectivity.status);
        setIsAiReachable(cachedAiConnectivity.reachable);
        return;
      }

      try {
        const nextStatus = await getAiStatus();
        if (!isMounted) return;
        cachedAiConnectivity = { status: nextStatus, reachable: true };
        setAiStatus(nextStatus);
        setIsAiReachable(true);
      } catch {
        if (!isMounted) return;
        cachedAiConnectivity = { status: null, reachable: false };
        setAiStatus(null);
        setIsAiReachable(false);
      }
    }

    void loadAiStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const stats = useMemo(
    () => ({
      totalProjects: projects.length,
      totalTasks: projects.reduce((sum, project) => sum + project.total_tasks, 0),
      completedTasks: projects.reduce((sum, project) => sum + project.completed_tasks, 0),
      activeTasks: projects.reduce((sum, project) => sum + project.total_tasks - project.completed_tasks, 0),
      overdueTasks: projects.reduce((sum, project) => sum + project.overdue_tasks, 0),
      todoTasks: projects.reduce((sum, project) => sum + Math.max(project.total_tasks - project.completed_tasks - project.in_progress_tasks, 0), 0),
      fixedRemainingMinutes: Math.round(projects.reduce((sum, project) => (project.type === "fixed" ? sum + project.remaining_hours : sum), 0) * 60),
      spentMinutes: Math.round(projects.reduce((sum, project) => sum + project.time_spent_hours, 0) * 60),
    }),
    [projects],
  );

  const focusMetrics = useMemo(() => {
    const { momentum } = getFocusMomentum(focusLogs, now);
    return {
      minutesToday: getFocusMinutesToday(focusLogs),
      momentum,
    };
  }, [focusLogs, now]);
  const projectedMonthlyCost = useMemo(() => {
    if (!aiCosts?.daily.length) return 0;
    return (aiCosts.total_cost_cents / aiCosts.daily.length) * 30;
  }, [aiCosts]);
  const liveFeed = buildLiveFeed(projects);
  const isLlmConnected = Boolean(isAiReachable && aiStatus?.connected);
  const timeLabel = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const clockLabel = `${dateLabel} : ${timeLabel}`;

  async function handleLogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = logText.trim();
    if (!trimmed || isLogging) return;
    if (!trimmed.startsWith("+") && !trimmed.startsWith("-")) {
      setError("Start the log with + for a new task or - for a completed task.");
      return;
    }

    setIsLogging(true);
    setError(null);
    setMessage(null);
    try {
      const response = await logGoalEntry(trimmed);
      setLogText("");
      setMessage(response.mode === "created_task" ? `Added task: ${response.corrected_text}` : `Logged completion: ${response.corrected_text}`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log entry");
    } finally {
      setIsLogging(false);
    }
  }

  async function handleCompassRefresh() {
    if (isRefreshingCompass) return;
    const requestId = ++compassRequestId.current;
    setIsRefreshingCompass(true);
    setCompassError(null);
    try {
      const assessment = await getCaptainCompass(true, compassContextDays);
      if (compassRequestId.current === requestId) setCaptainCompass(assessment);
    } catch (err) {
      if (compassRequestId.current === requestId) {
        setCompassError(err instanceof Error ? err.message : "Could not refresh Captain Compass");
      }
    } finally {
      if (compassRequestId.current === requestId) setIsRefreshingCompass(false);
    }
  }

  return (
    <main className="ops-screen">
      <section className="ops-header">
        <div>
          <p className="ops-kicker">JARVIS / LIFE COMMAND CENTER</p>
          <h1>Command Overview</h1>
          <p className="ops-subtitle">Daily briefing, activity stream, and compact system telemetry.</p>
        </div>
        <div className="ops-header-actions dashboard-header-actions">
          <div className="dashboard-clock" aria-label={clockLabel}>
            {clockLabel}
          </div>
          <div className="dashboard-action-tiles">
            <a href="/goals" className="ops-button primary dashboard-action-tile">Mission Control</a>
            <span className={isLlmConnected ? "llm-status-tile connected" : "llm-status-tile disconnected"}>
              <span className="llm-status-symbol" aria-hidden="true">
                {isLlmConnected ? <span className="llm-live-dot" /> : <span className="llm-cross" />}
              </span>
              {isLlmConnected ? "LLM Live" : "LLM Offline"}
            </span>
          </div>
        </div>
      </section>

      {error ? <p className="ops-alert danger">{error}</p> : null}
      {message ? <p className="ops-alert signal">{message}</p> : null}

      <section className="ops-grid overview-grid">
        <div className="ops-panel span-4">
          <PanelHeader label="Today's Briefing" detail={new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} />
          <div className="dashboard-text-list">
            <TextMetric label="Active Tasks" value={stats.activeTasks} signal />
            <TextMetric label="Overdue Tasks" value={stats.overdueTasks} danger={stats.overdueTasks > 0} />
            <TextMetric label="Today's Focus Time" value={`${focusMetrics.minutesToday}m`} signal />
            <TextMetric label="Current Momentum" value={`${focusMetrics.momentum}%`} signal />
            <TextMetric label="Fixed Remaining" value={`${stats.fixedRemainingMinutes}m`} />
          </div>
        </div>

        <div className="ops-panel span-4">
          <div className="captain-compass-head">
            <PanelHeader
              label="Captain Compass"
              detail={isLoadingCompass ? "Loading context" : captainCompass ? formatCompassStatus(captainCompass.status) : "Assessing course"}
            />
            <div className="captain-compass-controls">
              <label>
                <span className="sr-only">Captain Compass context range</span>
                <select
                  value={compassContextDays}
                  onChange={(event) => setCompassContextDays(Number(event.target.value) as CaptainCompassContextDays)}
                  disabled={isRefreshingCompass}
                  aria-label="Captain Compass context range"
                >
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </label>
              <button
                type="button"
                className="ops-button primary captain-compass-refresh"
                onClick={() => void handleCompassRefresh()}
                disabled={isLoadingCompass || isRefreshingCompass}
              >
                {isRefreshingCompass ? "Assessing..." : "Refresh"}
              </button>
            </div>
          </div>
          {compassError ? <p className="captain-compass-error">{compassError}</p> : null}
          <div className="captain-compass-ratings">
            <CompassRating label="Speed" value={captainCompass?.speed_rating} />
            <CompassRating label="Direction" value={captainCompass?.direction_rating} />
            <CompassRating label="Consistency" value={captainCompass?.consistency_rating} />
            <CompassRating label="Overall" value={captainCompass?.overall_rating} signal />
          </div>
          <p className="captain-compass-summary">
            {captainCompass?.summary ?? `Captain Compass is reading your goal and project timelines from the last ${compassContextDays} days.`}
          </p>
          {captainCompass?.advice ? <p className="captain-compass-advice">{captainCompass.advice}</p> : null}
          {captainCompass ? (
            <p className="captain-compass-meta">
              Last {captainCompass.context_days} days / {captainCompass.model} / {formatCompassTime(captainCompass.refreshed_at)}
            </p>
          ) : null}
        </div>

        <div className="ops-panel span-4">
          <PanelHeader label="💰 LLM Usage" detail="Cost projection" />
          <div className="dashboard-text-list">
            <TextMetric label="Today Cost" value={formatCents(aiCosts?.today_cost_cents ?? 0)} signal />
            <TextMetric label="Monthly Cost" value={formatCents(projectedMonthlyCost)} />
          </div>
        </div>

        <div className="ops-panel span-12">
          <PanelHeader label="Live Feed" detail="Recent activity log" />
          <div className="ops-feed dashboard-live-feed">
            {liveFeed.map((item) => (
              <div key={`${item.time}-${item.text}`} className="feed-line">
                <span>{item.time}</span>
                <p>--&gt; {item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mission-log-spacer" aria-hidden="true" />

      <form onSubmit={handleLogSubmit} className="mission-log-dock">
        <div className="mission-log-control">
          <input
            value={logText}
            onChange={(event) => setLogText(event.target.value)}
            placeholder="+ Add objective or - log completed objective"
            className="mission-log-input"
          />
          <button
            type="submit"
            disabled={isLogging || !logText.trim()}
            className="mission-log-submit"
            aria-label="Send log"
            title="Send log"
          >
            Go
          </button>
        </div>
      </form>
    </main>
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

function TextMetric({
  label,
  value,
  signal = false,
  danger = false,
  muted = false,
}: {
  label: string;
  value: string | number;
  signal?: boolean;
  danger?: boolean;
  muted?: boolean;
}) {
  const tone = danger ? " danger" : signal ? " signal" : muted ? " muted" : "";
  return (
    <div className={`dashboard-text-metric${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompassRating({
  label,
  value,
  signal = false,
}: {
  label: string;
  value?: number;
  signal?: boolean;
}) {
  return (
    <div className={signal ? "captain-compass-rating signal" : "captain-compass-rating"}>
      <span>{label}</span>
      <strong>{value ?? "-"}/10</strong>
    </div>
  );
}

function buildLiveFeed(projects: ProjectSummary[]) {
  const now = new Date();
  const lines = projects
    .flatMap((project, index) => [
      {
        time: timeBack(now, index * 17 + 4),
        text: `${project.completed_tasks} completed / ${project.name}`,
      },
      {
        time: timeBack(now, index * 19 + 11),
        text: `${project.in_progress_tasks} active / ${project.name}`,
      },
    ])
    .slice(0, 7);

  return lines.length
    ? lines
    : [
        { time: timeBack(now, 9), text: "Awaiting first mission event" },
        { time: timeBack(now, 22), text: "System telemetry online" },
        { time: timeBack(now, 37), text: "Command overview initialized" },
      ];
}

function timeBack(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60_000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatCents(value: number) {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: 6,
  })}¢`;
}

function formatCompassStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatCompassTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
