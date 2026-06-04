"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TaskEditor } from "@/components/TaskEditor";
import {
  createTask,
  getProjectPomodoroSessions,
  getProjects,
  getProjectTasks,
  updateTask,
  type PomodoroProjectSession,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskUpdate,
} from "@/lib/api";
import "./ProjectDetailPage.css";

type StatusFilter = "all" | "incomplete" | TaskStatus;
type PriorityFilter = "all" | TaskPriority;

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<PomodoroProjectSession[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eta, setEta] = useState("60");
  const [spent, setSpent] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
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
      const [projects, projectTasks, projectSessions] = await Promise.all([
        getProjects(),
        getProjectTasks(projectId),
        getProjectPomodoroSessions(projectId),
      ]);
      setProject(projects.find((item) => item.id === projectId) ?? null);
      setTasks(projectTasks);
      setSessions(projectSessions);
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
    setEta("60");
    setSpent("0");
    setStartDate("");
    setDeadline("");
    setStatus("todo");
    setPriority("medium");
    setIsCreateTaskOpen(false);
  }

  async function handleStatusChange(taskId: string, nextStatus: TaskStatus) {
    const updated = await updateTask(taskId, { status: nextStatus });
    setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
  }

  async function handleTaskSave(taskId: string, changes: TaskUpdate) {
    const updated = await updateTask(taskId, changes);
    setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
    setEditingTask((current) => (current?.id === taskId ? updated : current));
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
  const sessionTimelineGroups = formatProjectSessionTimeline(sessions);
  const filteredTasks = tasks.filter((task) => {
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "incomplete" ? task.status !== "done" : task.status === statusFilter);
    const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;

    return matchesStatus && matchesPriority;
  });

  return (
    <main className="ops-screen">
      <Link href="/" className="ops-button">
        Back to Command Overview
      </Link>

      <header className="ops-header mt-4">
        <div>
          <p className="ops-kicker">{project?.type ?? "MISSION"}</p>
          <h1>{project?.name ?? "Mission Detail"}</h1>
          <p className="ops-subtitle">Objective queue, time telemetry, and execution log.</p>
        </div>
        <div className="system-metrics sm:min-w-80">
          <div>
            <p className="text-sm text-gray-500">Invested Time</p>
            <p className="mt-1 text-3xl font-semibold text-gray-950">{investedMinutes} min</p>
          </div>
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

      <section className="project-text-section">
        <div className="project-section-head">
          <div>
            <div className="project-title-line">
              <h2>Objectives</h2>
              <button
                type="button"
                onClick={() => setIsCreateTaskOpen((current) => !current)}
                className="ops-button primary"
              >
                {isCreateTaskOpen ? "Close" : "Add Objective"}
              </button>
            </div>
            <p className="project-meta-line">
              {filteredTasks.length} shown of {tasks.length} total objectives
            </p>
          </div>
          <div className="project-filter-line">
            <label>
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">All</option>
                <option value="incomplete">Incomplete</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </label>
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
        {!isLoading && tasks.length === 0 ? (
          <p className="project-empty-line">
            Add your first objective to see progress and timeline bars.
          </p>
        ) : null}
        {!isLoading && tasks.length > 0 && filteredTasks.length === 0 ? (
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
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      </section>

      <section className="project-text-section">
        <div className="project-section-head compact">
          <h2>Timeline</h2>
          <p className="project-meta-line">{investedMinutes} min logged</p>
        </div>
        <div className="project-timeline-list">
          {tasks.map((task) => (
            <ProjectTimelineRow key={task.id} task={task} onEdit={setEditingTask} />
          ))}
        </div>
        <div className="project-session-log">
          {sessionTimelineGroups.length === 0 ? <p>No completed session descriptions yet.</p> : null}
          {sessionTimelineGroups.map((group) => (
            <div key={group.date} className="project-session-group">
              <div className="project-session-lines">
                {group.sessions.map((session) => (
                  <div key={session.id} className="project-session-line">
                    <p>
                      {group.date} --&gt; {session.minutes} minutes
                    </p>
                    <p>{session.description?.trim() || "(No description)"}</p>
                  </div>
                ))}
              </div>
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
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Deadline</span>
              <input
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Start date</span>
              <input
                type="date"
                value={startDate}
                disabled={status === "todo"}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </label>
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
  onStatusChange,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onStatusChange: (taskId: string, nextStatus: TaskStatus) => void;
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
      <select
        value={task.status}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)}
        className="project-objective-status"
        aria-label={`Status for ${task.title}`}
      >
        <option value="todo">Todo</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
      </select>
    </div>
  );
}

function ProjectTimelineRow({ task, onEdit }: { task: Task; onEdit: (task: Task) => void }) {
  const etaMinutes = Math.round(task.eta_hours * 60);
  const spentMinutes = Math.round(task.time_spent_hours * 60);
  const remainingMinutes = task.status === "done" ? 0 : Math.max(etaMinutes - spentMinutes, 0);
  const deadline = task.deadline ? new Date(task.deadline) : null;
  const daysUntilDeadline = deadline ? getDayDifference(deadline, new Date()) : null;

  return (
    <button type="button" onClick={() => onEdit(task)} className="project-timeline-row">
      <span>{formatTaskDate(task.start_date ?? task.created_at, "unknown")} --&gt; {formatTaskDate(task.deadline, "open")}</span>
      <strong>{task.title}</strong>
      <span>{task.status.replace("_", " ")} / {spentMinutes}m logged / {remainingMinutes}m left / {etaMinutes}m eta</span>
      <span>{formatDeadlineState(daysUntilDeadline)}</span>
    </button>
  );
}

function getDayDifference(later: Date, earlier: Date) {
  const laterDay = new Date(later);
  const earlierDay = new Date(earlier);

  laterDay.setHours(0, 0, 0, 0);
  earlierDay.setHours(0, 0, 0, 0);

  return Math.ceil((laterDay.getTime() - earlierDay.getTime()) / (1000 * 60 * 60 * 24));
}

function formatTaskDate(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDeadlineState(daysUntilDeadline: number | null) {
  if (daysUntilDeadline === null) return "no deadline";
  if (daysUntilDeadline < 0) return `${Math.abs(daysUntilDeadline)}d late`;
  if (daysUntilDeadline === 0) return "due today";
  return `${daysUntilDeadline}d left`;
}

function formatProjectSessionTimeline(sessions: PomodoroProjectSession[]) {
  const grouped = sessions.reduce<Record<string, PomodoroProjectSession[]>>((acc, session) => {
    const date = new Date(session.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    acc[date] = acc[date] ?? [];
    acc[date].push(session);
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([date, daySessions]) => ({
      date,
      sessions: daySessions.sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()),
    }));
}
