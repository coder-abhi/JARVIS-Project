"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  getGoalsOverview,
  getProjectSummaries,
  updateGoal,
  updateProject,
  type CompletedGoalLog,
  type Goal,
  type GoalTask,
  type ProjectSummary,
} from "@/lib/api";
import "./GoalDetailPage.css";

const categoryLabels: Record<Goal["category"], string> = {
  monthly: "Monthly Goal",
  quarterly: "Quarterly Goal",
  yearly: "Yearly Goal",
  five_year: "5-Year Goal",
};

export default function GoalDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const goalId = params.id ?? "";
  const [goal, setGoal] = useState<Goal | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [activeTasks, setActiveTasks] = useState<GoalTask[]>([]);
  const [completions, setCompletions] = useState<CompletedGoalLog[]>([]);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isEditing, setIsEditing] = useState(searchParams.get("edit") === "1");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAttachProjectOpen, setIsAttachProjectOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isAttachingProject, setIsAttachingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadGoal = useCallback(async () => {
    if (!goalId) return;
    setError(null);
    const [overview, summaries] = await Promise.all([getGoalsOverview(), getProjectSummaries()]);
    const currentGoal = overview.goals.find((item) => item.id === goalId) ?? null;
    if (!currentGoal) {
      setGoal(null);
      setProjects([]);
      setActiveTasks([]);
      setCompletions([]);
      throw new Error("Goal not found");
    }

    const attachedProjects = summaries.filter(
      (project) => project.goal_id === goalId || project.linked_goals.some((linkedGoal) => linkedGoal.id === goalId),
    );
    const projectIds = new Set(attachedProjects.map((project) => project.id));

    setGoal(currentGoal);
    setNameDraft(currentGoal.title);
    setDescriptionDraft(currentGoal.description ?? "");
    setProjects(attachedProjects);
    setAllProjects(summaries);
    setActiveTasks(overview.active_tasks.filter((task) => task.linked_goals.some((linkedGoal) => linkedGoal.id === goalId)));
    setCompletions(
      overview.recent_completed_tasks.filter(
        (item) => item.goal_id === goalId || Boolean(item.project_id && projectIds.has(item.project_id)),
      ),
    );
  }, [goalId]);

  useEffect(() => {
    setIsLoading(true);
    loadGoal()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [loadGoal]);

  async function handleGoalSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goal || !nameDraft.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateGoal(goal.id, {
        title: nameDraft.trim(),
        description: descriptionDraft.trim() || null,
      });
      setGoal(updated);
      setIsEditing(false);
      setSearchParams({}, { replace: true });
      setMessage("Goal identity updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update goal");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAttachProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !goal || isAttachingProject) return;
    setIsAttachingProject(true);
    setError(null);
    try {
      await updateProject(selectedProjectId, { goal_id: goal.id });
      setSelectedProjectId("");
      setIsAttachProjectOpen(false);
      setMessage("Project attached to this goal.");
      await loadGoal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach project");
    } finally {
      setIsAttachingProject(false);
    }
  }

  const totals = useMemo(
    () =>
      projects.reduce(
        (acc, project) => ({
          tasks: acc.tasks + project.total_tasks,
          completed: acc.completed + project.completed_tasks,
          overdue: acc.overdue + project.overdue_tasks,
          investedMinutes: acc.investedMinutes + Math.round(project.time_spent_hours * 60),
        }),
        { tasks: 0, completed: 0, overdue: 0, investedMinutes: 0 },
      ),
    [projects],
  );
  const completionPercentage = totals.tasks ? Math.round((totals.completed / totals.tasks) * 100) : 0;
  const nextDeadline = getNextDeadline(projects);
  const timelineItems = buildTimeline(goal, projects, completions);
  const attachableProjects = allProjects.filter((project) => !projects.some((attached) => attached.id === project.id));

  if (isLoading) {
    return <main className="ops-screen goal-detail-state">Loading goal...</main>;
  }

  return (
    <main className="ops-screen">
      <button type="button" onClick={() => router.back()} className="ops-button">
        Back
      </button>

      <header className="ops-header mt-4">
        <div className="goal-detail-heading">
          <p className="ops-kicker">{goal ? categoryLabels[goal.category] : "Goal Detail"}</p>
          <div className="goal-heading-line">
            <h1>{goal?.title ?? "Goal not found"}</h1>
            {goal ? (
              <button type="button" onClick={() => setIsEditing(true)} className="ops-button">
                Edit Goal
              </button>
            ) : null}
          </div>
          <p className="ops-subtitle goal-header-why">
            {goal?.description || "No why has been written for this goal yet."}
          </p>
        </div>
        {goal ? (
          <div className="system-metrics goal-header-metrics">
            <Metric label="Projects" value={String(projects.length)} signal />
            <Metric label="Objectives" value={`${totals.completed}/${totals.tasks}`} />
            <Metric label="Invested" value={`${totals.investedMinutes}m`} />
            <Metric label="Next Date" value={nextDeadline ? formatDate(nextDeadline) : "Open"} />
          </div>
        ) : null}
      </header>

      {error ? <p className="ops-alert danger">{error}</p> : null}
      {message ? <p className="ops-alert signal">{message}</p> : null}

      {goal && isEditing ? (
        <form onSubmit={handleGoalSave} className="goal-metadata-editor">
          <label>
            <span>Goal name</span>
            <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} autoFocus />
          </label>
          <label>
            <span>Why this goal matters</span>
            <textarea
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              rows={5}
              placeholder="State the reason this goal deserves your time and attention."
            />
          </label>
          <div className="goal-metadata-actions">
            <button
              type="button"
              onClick={() => {
                setNameDraft(goal.title);
                setDescriptionDraft(goal.description ?? "");
                setIsEditing(false);
                setSearchParams({}, { replace: true });
              }}
              className="ops-button"
            >
              Cancel
            </button>
            <button disabled={isSaving || !nameDraft.trim()} className="ops-button primary">
              {isSaving ? "Saving..." : "Save Goal"}
            </button>
          </div>
        </form>
      ) : null}

      {goal ? (
        <div className="goal-detail-grid">
          <section className="ops-panel goal-why-panel">
            <div className="ops-panel-head">
              <h2>Why</h2>
              <span>Always visible</span>
            </div>
            <p>{goal.description || "No why has been captured. Use Edit Goal to make the purpose explicit."}</p>
          </section>

          <section className="ops-panel goal-signal-panel">
            <div className="ops-panel-head">
              <h2>Execution Signal</h2>
              <span>{goal.measurable ? "Measured goal" : "Project-derived"}</span>
            </div>
            <div className="goal-progress-copy">
              <strong>{goal.measurable && goal.progress_percentage != null ? `${goal.progress_percentage}%` : `${completionPercentage}%`}</strong>
              <span>
                {goal.measurable
                  ? `${formatNumber(goal.current_value)} / ${formatNumber(goal.target_value ?? 0)} ${goal.unit ?? ""}`.trim()
                  : `${totals.completed} of ${totals.tasks} project objectives complete`}
              </span>
            </div>
            <div className="goal-progress-track">
              <span style={{ width: `${goal.measurable ? goal.progress_percentage ?? 0 : completionPercentage}%` }} />
            </div>
            <div className="goal-signal-foot">
              <span>{activeTasks.length} active objectives</span>
              <span className={totals.overdue ? "danger" : "signal"}>
                {totals.overdue ? `${totals.overdue} overdue` : "On track"}
              </span>
            </div>
          </section>
        </div>
      ) : null}

      {goal ? (
        <>
          <section className="goal-text-section">
            <div className="goal-section-head">
              <div>
                <div className="goal-title-line">
                  <h2>Attached Projects</h2>
                  <button type="button" onClick={() => setIsAttachProjectOpen((current) => !current)} className="ops-button primary">
                    {isAttachProjectOpen ? "Close" : "Attach Project"}
                  </button>
                </div>
                <p className="goal-meta-line">{projects.length} projects advancing this goal</p>
              </div>
              <p className="goal-meta-line">{totals.investedMinutes} min invested across the portfolio</p>
            </div>

            {isAttachProjectOpen ? (
              <form onSubmit={handleAttachProject} className="goal-project-creator">
                <label>
                  <span>Choose project</span>
                  <select
                    value={selectedProjectId}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    autoFocus
                  >
                    <option value="">Select an existing project</option>
                    {attachableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {formatProjectOption(project)}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {attachableProjects.length
                    ? "Attaching a project already linked to another goal will move it here."
                    : "Every project is already attached to this goal."}
                </p>
                <button disabled={isAttachingProject || !selectedProjectId} className="ops-button primary">
                  {isAttachingProject ? "Attaching..." : "Attach Project"}
                </button>
              </form>
            ) : null}

            {projects.length ? (
              <div className="goal-project-list">
                {projects.map((project) => (
                  <GoalProjectRow key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <p className="goal-empty-line">No projects are attached yet. Attach an existing project that will move this goal forward.</p>
            )}
          </section>

          <section className="goal-text-section">
            <div className="goal-section-head compact">
              <div>
                <h2>Timeline</h2>
                <p className="goal-meta-line">Project starts, next deadlines, and recent completed work</p>
              </div>
              <span className="goal-meta-line">{timelineItems.length} events</span>
            </div>
            <div className="goal-timeline">
              {timelineItems.map((item) => (
                <div key={item.id} className={`goal-timeline-item ${item.tone}`}>
                  <time>{formatDate(item.date)}</time>
                  <span className="goal-timeline-marker" />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function GoalProjectRow({ project }: { project: ProjectSummary }) {
  const progress = project.total_tasks ? Math.round((project.completed_tasks / project.total_tasks) * 100) : 0;
  const remaining = Math.max(project.total_tasks - project.completed_tasks, 0);

  return (
    <Link href={`/project/${project.id}`} className="goal-project-row">
      <div className="goal-project-identity">
        <span className={`goal-project-type ${project.type}`}>{project.type}</span>
        <strong>{project.name}</strong>
        <p>{project.description || "No project description."}</p>
      </div>
      <div className="goal-project-progress">
        <div>
          <span>{progress}% complete</span>
          <span>{remaining} open</span>
        </div>
        <div className="goal-project-progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="goal-project-telemetry">
        <span>{Math.round(project.time_spent_hours * 60)}m invested</span>
        <span>{project.next_deadline ? formatDeadlineState(project.next_deadline) : "No deadline"}</span>
        <span className={project.overdue_tasks ? "danger" : "signal"}>
          {project.overdue_tasks ? `${project.overdue_tasks} overdue` : "On track"}
        </span>
      </div>
      <span className="goal-project-open">Open</span>
    </Link>
  );
}

function Metric({ label, value, signal = false }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className={`system-metric${signal ? " signal" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type TimelineItem = {
  id: string;
  date: string;
  title: string;
  detail: string;
  tone: "signal" | "muted" | "danger";
};

function buildTimeline(goal: Goal | null, projects: ProjectSummary[], completions: CompletedGoalLog[]): TimelineItem[] {
  if (!goal) return [];
  const items: TimelineItem[] = [
    {
      id: `goal-${goal.id}`,
      date: goal.created_at,
      title: "Goal established",
      detail: goal.description || "Purpose pending.",
      tone: "signal",
    },
  ];

  for (const project of projects) {
    items.push({
      id: `project-${project.id}`,
      date: project.created_at,
      title: `${project.name} attached`,
      detail: `${project.type} project / ${project.total_tasks} objectives / ${Math.round(project.time_spent_hours * 60)}m invested`,
      tone: "muted",
    });
    if (project.next_deadline) {
      items.push({
        id: `deadline-${project.id}-${project.next_deadline}`,
        date: project.next_deadline,
        title: `${project.name} next deadline`,
        detail: project.overdue_tasks ? `${project.overdue_tasks} overdue objectives need attention.` : "Nearest active delivery date.",
        tone: project.overdue_tasks ? "danger" : "signal",
      });
    }
  }

  for (const completion of completions) {
    items.push({
      id: `completion-${completion.id}`,
      date: completion.created_at,
      title: completion.title,
      detail: "Objective completed and logged.",
      tone: "signal",
    });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function getNextDeadline(projects: ProjectSummary[]) {
  const deadlines = projects
    .map((project) => project.next_deadline)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return deadlines[0] ?? null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDeadlineState(value: string) {
  const deadline = new Date(value);
  const today = new Date();
  deadline.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatProjectOption(project: ProjectSummary) {
  const currentGoal = project.linked_goals[0]?.title;
  return `${project.name} / ${project.type}${currentGoal ? ` / currently: ${currentGoal}` : ""}`;
}
