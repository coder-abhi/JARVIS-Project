"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TaskEditor } from "@/components/TaskEditor";
import { DateTimePicker } from "@/components/DateTimePicker";
import {
  createTask,
  deleteCompletedGoal,
  deleteTask,
  getGoalsOverview,
  getProjectCompletions,
  getProjectPomodoroSessions,
  getProjects,
  getProjectTasks,
  updateProject,
  updateTask,
  type Goal,
  type CompletedGoalLog,
  type PomodoroProjectSession,
  type Project,
  type ProjectType,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskUpdate,
} from "@/lib/api";
import { readProjectBehaviorSettings } from "@/lib/appSettings";
import "./ProjectDetailPage.css";

type PriorityFilter = "all" | TaskPriority;

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<PomodoroProjectSession[]>([]);
  const [completions, setCompletions] = useState<CompletedGoalLog[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eta, setEta] = useState(() => String(readProjectBehaviorSettings().defaultTaskMinutes));
  const [spent, setSpent] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<TaskStatus>(() => readProjectBehaviorSettings().defaultTaskStatus);
  const [priority, setPriority] = useState<TaskPriority>(() => readProjectBehaviorSettings().defaultTaskPriority);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState("");
  const [projectTypeDraft, setProjectTypeDraft] = useState<ProjectType>("fixed");
  const [projectGoalIdDraft, setProjectGoalIdDraft] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setProjectId(params.id ?? "");
  }, [params.id]);

  useEffect(() => {
    if (!projectId) return;

    async function loadProject() {
      setIsLoading(true);
      setError(null);
      const [projects, projectTasks, projectSessions, projectCompletions, goalsOverview] = await Promise.all([
        getProjects(),
        getProjectTasks(projectId),
        getProjectPomodoroSessions(projectId),
        getProjectCompletions(projectId),
        getGoalsOverview(),
      ]);
      const currentProject = projects.find((item) => item.id === projectId) ?? null;
      setProject(currentProject);
      setProjectNameDraft(currentProject?.name ?? "");
      setProjectDescriptionDraft(currentProject?.description ?? "");
      setProjectTypeDraft(currentProject?.type ?? "fixed");
      setProjectGoalIdDraft(currentProject?.goal_id ?? "");
      setGoals(goalsOverview.goals);
      setTasks(projectTasks);
      setSessions(projectSessions);
      setCompletions(projectCompletions);
      setIsLoading(false);
    }

    loadProject().catch((err: Error) => {
      setError(err.message);
      setIsLoading(false);
    });
  }, [projectId]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !projectId) return;

    const task = await createTask({
      project_id: projectId,
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      eta_hours: minutesInputToHours(eta),
      time_spent_hours: minutesInputToHours(spent),
      start_date: status === "todo" ? null : startDate ? new Date(startDate).toISOString() : null,
      deadline: deadline ? new Date(deadline).toISOString() : null,
    });

    setTasks((current) => [task, ...current]);
    setTitle("");
    setDescription("");
    const defaults = readProjectBehaviorSettings();
    setEta(String(defaults.defaultTaskMinutes));
    setSpent("0");
    setStartDate("");
    setDeadline("");
    setStatus(defaults.defaultTaskStatus);
    setPriority(defaults.defaultTaskPriority);
    setIsCreateTaskOpen(false);
  }

  async function handleTaskSave(taskId: string, changes: TaskUpdate) {
    const updated = await updateTask(taskId, changes);
    setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
    setEditingTask((current) => (current?.id === taskId ? updated : current));
  }

  async function handleProjectSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !projectNameDraft.trim()) return;
    setIsSavingProject(true);
    setError(null);
    try {
      const updated = await updateProject(project.id, {
        name: projectNameDraft.trim(),
        description: projectDescriptionDraft.trim() || null,
        type: projectTypeDraft,
        goal_id: projectGoalIdDraft || null,
      });
      setProject(updated);
      setIsEditingProject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update project");
    } finally {
      setIsSavingProject(false);
    }
  }

  function toggleCreateTask() {
    setIsCreateTaskOpen((current) => {
      if (!current) {
        const defaults = readProjectBehaviorSettings();
        setEta(String(defaults.defaultTaskMinutes));
        setStatus(defaults.defaultTaskStatus);
        setPriority(defaults.defaultTaskPriority);
      }
      return !current;
    });
  }

  async function handleDeleteTask(task: Task) {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    setError(null);
    try {
      await deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setCompletions((current) => current.filter((item) => item.task_id !== task.id));
      setEditingTask((current) => (current?.id === task.id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete objective");
    }
  }

  async function handleDeleteTimelineItem(item: ProjectActivityTimelineItem) {
    const label = item.task?.title ?? item.description;
    if (!window.confirm(`Delete "${label}" from this project timeline?`)) return;
    setError(null);
    try {
      if (item.task) {
        await deleteTask(item.task.id);
        setTasks((current) => current.filter((task) => task.id !== item.task?.id));
        setCompletions((current) => current.filter((completion) => completion.task_id !== item.task?.id));
        return;
      }
      if (item.completionId) {
        await deleteCompletedGoal(item.completionId);
        setCompletions((current) => current.filter((completion) => completion.id !== item.completionId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete timeline entry");
    }
  }

  const totals = tasks.reduce(
    (acc, task) => ({
      eta: acc.eta + task.eta_hours,
      spent: acc.spent + task.time_spent_hours,
    }),
    { eta: 0, spent: 0 },
  );
  const taskSpentMinutes = Math.round(totals.spent * 60);
  const sessionMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const investedMinutes = taskSpentMinutes + sessionMinutes;
  const completedTasks = tasks.filter((task) => task.status === "done").length;
  const activeTasks = tasks.length - completedTasks;
  const timelineItems = formatProjectActivityTimeline(tasks, sessions, completions);
  const incompleteTasks = tasks.filter((task) => task.status !== "done");
  const filteredTasks = incompleteTasks.filter((task) => {
    const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
    return matchesPriority;
  });

  return (
    <main className="ops-screen">
      <button type="button" onClick={() => router.back()} className="ops-button">
        Back
      </button>

      <header className="ops-header mt-4">
        <div>
          <p className="ops-kicker">{project?.type ?? "MISSION"}</p>
          <div className="project-heading-line">
            <h1>{project?.name ?? "Mission Detail"}</h1>
            {project ? (
              <button type="button" onClick={() => setIsEditingProject(true)} className="ops-button">
                Edit Project
              </button>
            ) : null}
          </div>
          <p className="ops-subtitle">
            {project?.description || "Objective queue, time telemetry, and execution log."}
          </p>
        </div>
        <div className="system-metrics sm:min-w-80">
          <div>
            <p className="text-sm text-gray-500">Invested Time</p>
            <p className="mt-1 text-3xl font-semibold text-gray-950">{investedMinutes} min</p>
          </div>
          {project?.type === "fixed" ? (
            <div>
              <p className="text-sm text-gray-500">Time Need</p>
              <p className="mt-1 text-3xl font-semibold text-gray-950">{Math.round(totals.eta * 60)} min</p>
            </div>
          ) : null}
          <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <p>
              <span className="font-semibold text-gray-950">{activeTasks}</span> active
            </p>
            <p>
              <span className="font-semibold text-emerald-700">{completedTasks}</span> complete
            </p>
          </div>
        </div>
      </header>

      {error ? <p className="ops-alert danger">{error}</p> : null}

      {isEditingProject ? (
        <form onSubmit={handleProjectSave} className="project-metadata-editor">
          <label>
            <span>Project name</span>
            <input
              value={projectNameDraft}
              onChange={(event) => setProjectNameDraft(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span>Project description</span>
            <textarea
              value={projectDescriptionDraft}
              onChange={(event) => setProjectDescriptionDraft(event.target.value)}
              rows={3}
              placeholder="What kind of tasks belong in this project?"
            />
          </label>
          <div className="project-metadata-selects">
            <label>
              <span>Project type</span>
              <select
                value={projectTypeDraft}
                onChange={(event) => setProjectTypeDraft(event.target.value as ProjectType)}
              >
                <option value="continuous">Continuous</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
            <label>
              <span>Attached goal</span>
              <select
                value={projectGoalIdDraft}
                onChange={(event) => setProjectGoalIdDraft(event.target.value)}
              >
                <option value="">No attached goal</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="project-metadata-actions">
            <button
              type="button"
              onClick={() => {
                setProjectNameDraft(project?.name ?? "");
                setProjectDescriptionDraft(project?.description ?? "");
                setProjectTypeDraft(project?.type ?? "fixed");
                setProjectGoalIdDraft(project?.goal_id ?? "");
                setIsEditingProject(false);
              }}
              className="ops-button"
            >
              Cancel
            </button>
            <button disabled={isSavingProject || !projectNameDraft.trim()} className="ops-button primary">
              {isSavingProject ? "Saving..." : "Save Project"}
            </button>
          </div>
        </form>
      ) : null}

      <section className="project-text-section">
        <div className="project-section-head">
          <div>
            <div className="project-title-line">
              <h2>Objectives</h2>
              <button
                type="button"
                onClick={toggleCreateTask}
                className="ops-button primary"
              >
                {isCreateTaskOpen ? "Close" : "Add Objective"}
              </button>
            </div>
            <p className="project-meta-line">
              {filteredTasks.length} shown of {incompleteTasks.length} incomplete objectives
            </p>
          </div>
          <div className="project-filter-line">
            <label>
              <span>Priority</span>
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
              >
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
        </div>
        {isLoading ? <p className="project-empty-line">Loading objectives...</p> : null}
        {!isLoading && incompleteTasks.length === 0 ? (
          <p className="project-empty-line">
            No incomplete objectives. Add a new objective when there is more work to do.
          </p>
        ) : null}
        {!isLoading && incompleteTasks.length > 0 && filteredTasks.length === 0 ? (
          <p className="project-empty-line">
            No tasks match the selected filters.
          </p>
        ) : null}
        <div className="project-objective-list">
          {filteredTasks.map((task) => (
            <ProjectObjectiveRow
              key={task.id}
              task={task}
              onEdit={setEditingTask}
              onDelete={handleDeleteTask}
            />
          ))}
        </div>
      </section>

      <section className="project-text-section">
        <div className="project-section-head compact">
          <h2>Timeline</h2>
          <p className="project-meta-line">{investedMinutes} min logged</p>
        </div>
        <div className="project-session-log">
          {timelineItems.length === 0 ? <p>No completed tasks or Pomodoro sessions logged yet.</p> : null}
          {timelineItems.map((item) => (
            <div
              key={item.id}
              role={item.task ? "button" : undefined}
              tabIndex={item.task ? 0 : undefined}
              onClick={() => {
                if (item.task) setEditingTask(item.task);
              }}
              onKeyDown={(event) => {
                if (item.task && (event.key === "Enter" || event.key === " ")) setEditingTask(item.task);
              }}
              className={item.task ? "project-session-line interactive" : "project-session-line"}
            >
              <div className="project-session-copy">
                <p>{item.date} --&gt; {item.minutes} minutes spent</p>
                <p>{item.description}</p>
              </div>
              {item.task || item.completionId ? (
                <button
                  type="button"
                  className="project-delete-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDeleteTimelineItem(item);
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {isCreateTaskOpen ? (
      <section className="mt-8 rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_280px]">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-400">New work item</p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950">Create Task</h2>
          </div>
          <div className="rounded-md bg-gray-950 p-4 text-white">
            <p className="text-sm text-stone-300">Next task budget</p>
            <p className="mt-2 text-2xl font-semibold">{Number(eta) || 0} min</p>
            <p className="mt-1 text-xs text-stone-400">{deadline ? `Due ${new Date(deadline).toLocaleDateString()}` : "No deadline selected"}</p>
            <p className="mt-1 text-xs text-stone-400">{status === "todo" ? "Starts when moved in progress" : startDate ? `Starts ${new Date(startDate).toLocaleDateString()}` : "Auto start on save"}</p>
          </div>
        </div>

        <form onSubmit={handleCreateTask} className="grid gap-5 border-t border-gray-100 p-5 lg:grid-cols-[1fr_280px]">
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Task title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Design dashboard filters"
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Notes, acceptance details, or context"
                rows={4}
                className="resize-none rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              />
            </label>
          </div>

          <div className="grid content-start gap-3">
            <DateTimePicker label="Deadline" mode="date" value={deadline} onChange={setDeadline} />
            <DateTimePicker
              label="Start date"
              mode="date"
              value={startDate}
              disabled={status === "todo"}
              onChange={setStartDate}
            />
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Priority</span>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-gray-700">ETA</span>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={eta}
                  onChange={(event) => setEta(event.target.value)}
                  placeholder="1"
                  className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-gray-700">Spent</span>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={spent}
                  onChange={(event) => setSpent(event.target.value)}
                  placeholder="0"
                  className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
                />
              </label>
            </div>
            <button className="mt-2 rounded-md bg-gray-950 px-4 py-3 font-medium text-white transition hover:bg-gray-800">
              Add task
            </button>
          </div>
        </form>
      </section>
      ) : null}

      <TaskEditor task={editingTask} onClose={() => setEditingTask(null)} onSave={handleTaskSave} />
    </main>
  );
}

function minutesInputToHours(value: string) {
  return Math.round(((Number(value) || 0) / 60) * 100) / 100;
}

function ProjectObjectiveRow({
  task,
  onEdit,
  onDelete,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const etaMinutes = Math.round(task.eta_hours * 60);
  const spentMinutes = Math.round(task.time_spent_hours * 60);
  const remainingMinutes = task.status === "done" ? 0 : Math.max(etaMinutes - spentMinutes, 0);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onEdit(task);
      }}
      className="project-objective-row"
    >
      <span className="project-objective-title">{task.title}</span>
      <span className="project-objective-meta">
        <span className={`project-priority ${task.priority}`}>{task.priority}</span>
        <span>{formatTaskDate(task.deadline, "open")}</span>
        <span>{remainingMinutes}m left</span>
        <span>{spentMinutes > 0 ? `${spentMinutes}/${etaMinutes}m` : `${etaMinutes}m eta`}</span>
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void onDelete(task);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="project-delete-button"
      >
        Delete
      </button>
    </div>
  );
}

function formatTaskDate(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type ProjectActivityTimelineItem = {
  id: string;
  timestamp: number;
  date: string;
  minutes: number;
  description: string;
  task: Task | null;
  completionId: string | null;
};

function formatProjectActivityTimeline(
  tasks: Task[],
  sessions: PomodoroProjectSession[],
  completions: CompletedGoalLog[],
): ProjectActivityTimelineItem[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const loggedTaskIds = new Set(completions.map((completion) => completion.task_id).filter(Boolean));
  return [
    ...sessions.map((session) => ({
      id: `session-${session.id}`,
      timestamp: new Date(session.completed_at).getTime(),
      date: new Date(session.completed_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      minutes: session.minutes,
      description: session.description?.trim() || "(No description)",
      task: null,
      completionId: null,
    })),
    ...completions.map((completion) => {
      const task = completion.task_id ? tasksById.get(completion.task_id) ?? null : null;
      return {
        id: `completion-${completion.id}`,
        timestamp: new Date(completion.created_at).getTime(),
        date: formatTimelineDate(completion.created_at),
        minutes: task ? Math.round(task.time_spent_hours * 60) : 0,
        description: completion.title,
        task,
        completionId: task ? null : completion.id,
      };
    }),
    ...tasks.filter((task) => task.status === "done" && !loggedTaskIds.has(task.id)).map((task) => ({
      id: `task-${task.id}`,
      timestamp: new Date(task.created_at).getTime(),
      date: formatTimelineDate(task.created_at),
      minutes: Math.round(task.time_spent_hours * 60),
      description: task.title,
      task,
      completionId: null,
    })),
  ].sort((a, b) => b.timestamp - a.timestamp);
}

function formatTimelineDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
