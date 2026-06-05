"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAiCosts,
  getAiStatus,
  getProjectSummaries,
  type AiCostSummary,
  type AiStatus,
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
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [isAiReachable, setIsAiReachable] = useState(true);
  const [now, setNow] = useState(() => new Date());

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

      <section className="ops-grid overview-grid">
        <div className="ops-panel span-4">
          <PanelHeader label="Today's Briefing" detail={new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} />
          <div className="dashboard-text-list">
            <TextMetric label="Active Tasks" value={stats.activeTasks} signal />
            <TextMetric label="Overdue Tasks" value={stats.overdueTasks} danger={stats.overdueTasks > 0} />
            <TextMetric label="Today's Focus Time" value={`${focusMetrics.minutesToday}m`} signal />
            <TextMetric label="Current Momentum" value={`${focusMetrics.momentum}%`} signal />
          </div>
        </div>

        <div className="ops-panel span-4">
          <PanelHeader label="System Metrics" detail="Current project inventory" />
          <div className="dashboard-text-list">
            <TextMetric label="Total Missions" value={stats.totalProjects} />
            <TextMetric label="Task Queue" value={stats.totalTasks} />
            <TextMetric label="Todo" value={stats.todoTasks} />
            <TextMetric label="Active" value={stats.activeTasks} signal />
            <TextMetric label="Completed" value={stats.completedTasks} signal />
            <TextMetric label="Overdue" value={stats.overdueTasks} danger={stats.overdueTasks > 0} />
            <TextMetric label="Time Invested" value={`${stats.spentMinutes}m`} />
            <TextMetric label="Fixed Remaining" value={`${stats.fixedRemainingMinutes}m`} />
          </div>
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
          <div className="ops-feed">
            {liveFeed.map((item) => (
              <div key={`${item.time}-${item.text}`} className="feed-line">
                <span>{item.time}</span>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
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
