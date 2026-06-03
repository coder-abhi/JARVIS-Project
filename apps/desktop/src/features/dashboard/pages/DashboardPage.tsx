"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createProject, getAiStatus, getProjectSummaries, type AiStatus, type ProjectSummary, type ProjectType } from "@/lib/api";
import "./DashboardPage.css";

const projectTypes: { value: ProjectType; label: string; description: string }[] = [
  { value: "fixed", label: "Fixed", description: "Scoped mission with a defined extraction point." },
  { value: "continuous", label: "Continuous", description: "Persistent operating loop or habit system." },
];

let cachedAiConnectivity: { status: AiStatus | null; reachable: boolean } | null = null;

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("fixed");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [isAiReachable, setIsAiReachable] = useState(true);
  const [now, setNow] = useState(() => new Date());

  async function loadDashboard() {
    setError(null);
    const summaries = await getProjectSummaries();
    setProjects(summaries);
  }

  useEffect(() => {
    loadDashboard()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
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
      activeTasks: projects.reduce((sum, project) => sum + project.in_progress_tasks, 0),
      overdueTasks: projects.reduce((sum, project) => sum + project.overdue_tasks, 0),
      todoTasks: projects.reduce((sum, project) => sum + Math.max(project.total_tasks - project.completed_tasks - project.in_progress_tasks, 0), 0),
      fixedRemainingMinutes: Math.round(projects.reduce((sum, project) => (project.type === "fixed" ? sum + project.remaining_hours : sum), 0) * 60),
      spentMinutes: Math.round(projects.reduce((sum, project) => sum + project.time_spent_hours, 0) * 60),
      completedHours: projects.reduce((sum, project) => sum + project.completed_hours, 0),
      remainingHours: projects.reduce((sum, project) => sum + project.remaining_hours, 0),
    }),
    [projects],
  );

  const completionBasis = stats.completedHours + stats.remainingHours;
  const completion = completionBasis === 0 ? 0 : Math.min(Math.round((stats.completedHours / completionBasis) * 100), 100);
  const focusScore = Math.min(99, Math.round((stats.spentMinutes / Math.max(stats.spentMinutes + stats.fixedRemainingMinutes, 1)) * 100));
  const consistency = Math.min(99, Math.round((stats.completedTasks / Math.max(stats.totalTasks, 1)) * 100));
  const energy = stats.overdueTasks > 0 ? 62 : stats.activeTasks > 0 ? 81 : 74;
  const streak = Math.max(0, Math.min(99, stats.completedTasks + Math.round(stats.spentMinutes / 120)));

  const activeMissions = [...projects].sort((a, b) => getMissionRisk(b) - getMissionRisk(a));
  const liveFeed = buildLiveFeed(projects);
  const isLlmConnected = Boolean(isAiReachable && aiStatus?.connected);
  const timeLabel = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const clockLabel = `${dateLabel} : ${timeLabel}`;

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isSaving) return;

    try {
      setIsSaving(true);
      setError(null);
      await createProject({ name: name.trim(), type });
      await loadDashboard();
      setName("");
      setType("fixed");
      setIsCreateOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="ops-screen">
      <section className="ops-header">
        <div>
          <p className="ops-kicker">JARVIS / LIFE COMMAND CENTER</p>
          <h1>Command Overview</h1>
          <p className="ops-subtitle">Execution telemetry, active missions, daily briefing, and system health.</p>
        </div>
        <div className="ops-header-actions dashboard-header-actions">
          <div className="dashboard-clock" aria-label={clockLabel}>
            {clockLabel}
          </div>
          <div className="dashboard-action-tiles">
            <button type="button" onClick={() => setIsCreateOpen(true)} className="ops-button primary dashboard-action-tile">
              New Mission
            </button>
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
        <div className="ops-panel span-7">
          <PanelHeader label="Execution Health" detail="Live operating posture" />
          <div className="health-grid">
            <SignalMetric label="Momentum" value={`${completion}%`} active={completion >= 50} />
            <SignalMetric label="Focus Score" value={`${focusScore}%`} active={focusScore >= 40} />
            <SignalMetric label="Consistency" value={`${consistency}%`} active={consistency >= 50} />
            <SignalMetric label="Energy" value={`${energy}%`} active={energy >= 70} />
            <SignalMetric label="Current Streak" value={`${streak}`} active={streak > 0} />
          </div>
        </div>

        <div className="ops-panel span-5">
          <PanelHeader label="Today's Briefing" detail={new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} />
          <div className="briefing-grid">
            <BriefingMetric label="Focus Hours" value={(stats.spentMinutes / 60).toFixed(1)} />
            <BriefingMetric label="Tasks Complete" value={stats.completedTasks} />
            <BriefingMetric label="Reading" value="STANDBY" muted />
            <BriefingMetric label="Workout" value="UNLINKED" muted />
            <BriefingMetric label="Calories" value="UNLINKED" muted />
          </div>
        </div>

        <div className="ops-panel span-8">
          <PanelHeader label="Active Missions" detail={`${activeMissions.length} tracked operations`} />
          <div className="ops-table">
            <div className="ops-row ops-row-head mission-row">
              <span>Mission</span>
              <span>Progress</span>
              <span>Status</span>
              <span>ETA</span>
            </div>
            {isLoading ? <p className="ops-empty">Loading mission telemetry...</p> : null}
            {!isLoading && activeMissions.length === 0 ? (
              <button type="button" onClick={() => setIsCreateOpen(true)} className="ops-empty action">
                No active missions. Initialize first mission.
              </button>
            ) : null}
            {activeMissions.map((project) => {
              const progress = getProjectProgress(project);
              return (
                <a key={project.id} href={`/project/${project.id}`} className="ops-row mission-row">
                  <span className="truncate">
                    <span className="ops-dot" />
                    {project.name}
                  </span>
                  <span>
                    <span className="ops-progress">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                    <b>{progress}%</b>
                  </span>
                  <span className={project.overdue_tasks > 0 ? "ops-status danger" : project.in_progress_tasks > 0 ? "ops-status signal" : "ops-status"}>
                    {project.overdue_tasks > 0 ? "RISK" : project.in_progress_tasks > 0 ? "ACTIVE" : "QUEUED"}
                  </span>
                  <span>{formatEta(project)}</span>
                </a>
              );
            })}
          </div>
        </div>

        <div className="ops-panel span-4">
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

        <div className="ops-panel span-12">
          <PanelHeader label="System Metrics" detail="Compact performance indicators" />
          <div className="system-metrics">
            <SystemMetric label="Total Missions" value={stats.totalProjects} />
            <SystemMetric label="Task Queue" value={stats.totalTasks} />
            <SystemMetric label="Todo" value={stats.todoTasks} />
            <SystemMetric label="Active" value={stats.activeTasks} signal />
            <SystemMetric label="Completed" value={stats.completedTasks} signal />
            <SystemMetric label="Overdue" value={stats.overdueTasks} danger={stats.overdueTasks > 0} />
            <SystemMetric label="Time Invested" value={`${stats.spentMinutes}m`} />
            <SystemMetric label="Fixed Remaining" value={`${stats.fixedRemainingMinutes}m`} />
          </div>
        </div>
      </section>

      {isCreateOpen ? (
        <div className="ops-modal-backdrop">
          <form onSubmit={handleCreateProject} className="dashboard-mission-modal">
            <div className="ops-modal-head">
              <div>
                <p className="ops-kicker">MISSION REGISTRY</p>
                <h2>Initialize Mission</h2>
              </div>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="ops-icon-button" aria-label="Close">
                x
              </button>
            </div>

            <label className="ops-field" htmlFor="project-name">
              Mission name
              <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            </label>

            <div className="ops-choice-grid">
              {projectTypes.map((item) => (
                <button key={item.value} type="button" onClick={() => setType(item.value)} className={type === item.value ? "ops-choice active" : "ops-choice"}>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>

            <div className="ops-modal-actions">
              <button type="button" onClick={() => setIsCreateOpen(false)} className="ops-button">
                Cancel
              </button>
              <button disabled={isSaving || !name.trim()} className="ops-button primary">
                {isSaving ? "Creating..." : "Create Mission"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
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

function SignalMetric({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="signal-metric">
      <span className={active ? "ops-dot pulse" : "ops-dot"} />
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function BriefingMetric({ label, value, muted = false }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div className={muted ? "briefing-metric muted" : "briefing-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SystemMetric({ label, value, signal = false, danger = false }: { label: string; value: string | number; signal?: boolean; danger?: boolean }) {
  return (
    <div className={danger ? "system-metric danger" : signal ? "system-metric signal" : "system-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getProjectProgress(project: ProjectSummary) {
  const progressBasis = project.completed_hours + project.remaining_hours;
  if (project.type === "continuous") {
    const spentMinutes = Math.round(project.time_spent_hours * 60);
    return Math.min(Math.round(((spentMinutes % 6000) / 6000) * 100), 100);
  }
  return progressBasis === 0 ? 0 : Math.min(Math.round((project.completed_hours / progressBasis) * 100), 100);
}

function getMissionRisk(project: ProjectSummary) {
  return project.overdue_tasks * 10 + project.in_progress_tasks + project.remaining_hours;
}

function formatEta(project: ProjectSummary) {
  if (project.next_deadline) return new Date(project.next_deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (project.type === "continuous") return `${Math.round(project.time_spent_hours * 60)}m logged`;
  return `${Math.round(project.remaining_hours * 60)}m rem`;
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
