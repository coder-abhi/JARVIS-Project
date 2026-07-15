"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LineTrendChart } from "@/components/LineTrendChart";
import { TaskEditor } from "@/components/TaskEditor";
import {
  breakdownGoalTask,
  completeGoalTask,
  createProject,
  createGoal,
  createTask,
  getGoalCompletionTrend,
  getGoalsOverview,
  getProjects,
  restoreCompletedGoal,
  updateTask,
  type CaptainCompassContextDays,
  type Goal,
  type GoalCategory,
  type GoalCompletionTrend,
  type GoalTask,
  type GoalsOverview,
  type Project,
  type ProjectType,
  type Task,
  type TaskPriority,
  type TaskUpdate,
} from "@/lib/api";
import TimelinePage from "@/features/timeline/pages/TimelinePage";
import { readProjectBehaviorSettings } from "@/lib/appSettings";
import "./GoalsPage.css";

const categoryLabels: Record<GoalCategory, string> = {
  monthly: "Monthly Mission Plan",
  quarterly: "Quarterly Campaign",
  yearly: "Yearly Theater",
  five_year: "5-Year Doctrine",
};

const categoryOrder: GoalCategory[] = ["monthly", "quarterly", "yearly", "five_year"];
const projectTypes: { value: ProjectType; label: string; description: string }[] = [
  { value: "fixed", label: "Fixed", description: "Scoped mission with a defined extraction point." },
  { value: "continuous", label: "Continuous", description: "Persistent operating loop or habit system." },
];

export default function GoalsPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<GoalsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const [splittingTaskId, setSplittingTaskId] = useState<string | null>(null);
  const [splitErrors, setSplitErrors] = useState<Record<string, string>>({});
  const [creatingGoalCategory, setCreatingGoalCategory] = useState<GoalCategory | null>(null);
  const [restoringCompletionId, setRestoringCompletionId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>(
    () => readProjectBehaviorSettings().defaultProjectType,
  );
  const [projectGoalIds, setProjectGoalIds] = useState<string[]>([]);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completionTrendRange, setCompletionTrendRange] = useState<CaptainCompassContextDays>(30);
  const [completionTrendMetric, setCompletionTrendMetric] = useState<CompletionTrendMetric>("tasks");
  const [completionTrend, setCompletionTrend] = useState<GoalCompletionTrend | null>(null);
  const [isCompletionTrendLoading, setIsCompletionTrendLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>(
    () => readProjectBehaviorSettings().defaultTaskPriority,
  );
  const [newTaskImportance, setNewTaskImportance] = useState(3);
  const [newTaskEta, setNewTaskEta] = useState(() => String(readProjectBehaviorSettings().defaultTaskMinutes));
  const [newTaskDeadline, setNewTaskDeadline] = useState("");

  async function loadGoals() {
    setError(null);
    const [data, projectList] = await Promise.all([getGoalsOverview(), getProjects()]);
    setOverview(data);
    setProjects(projectList);
  }

  useEffect(() => {
    loadGoals()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsCompletionTrendLoading(true);
    getGoalCompletionTrend(completionTrendRange)
      .then((data) => {
        if (!cancelled) setCompletionTrend(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsCompletionTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [completionTrendRange]);

  const taskTree = useMemo(() => buildTaskTree(overview?.active_tasks ?? []), [overview?.active_tasks]);

  const sortedTaskTree = useMemo(() => {
    const roots = [...taskTree];
    return roots.sort((a, b) => b.importance_rating - a.importance_rating || a.time_required_minutes - b.time_required_minutes);
  }, [taskTree]);

  const goalsByCategory = useMemo(() => {
    const grouped: Record<GoalCategory, Goal[]> = {
      monthly: [],
      quarterly: [],
      yearly: [],
      five_year: [],
    };
    for (const goal of overview?.goals ?? []) {
      grouped[goal.category].push(goal);
    }
    return grouped;
  }, [overview?.goals]);

  const leafTasks = useMemo(() => (overview?.active_tasks ?? []).filter((task) => !task.has_children), [overview?.active_tasks]);
  const openTaskCount = useMemo(() => leafTasks.filter((task) => task.status !== "done").length, [leafTasks]);
  const requiredMinutes = useMemo(
    () => leafTasks.reduce((sum, task) => sum + getRemainingTaskMinutes(task), 0),
    [leafTasks],
  );

  async function handleCreateGoal(category: GoalCategory) {
    setCreatingGoalCategory(category);
    setError(null);
    try {
      const goal = await createGoal({
        category,
        title: `New ${categoryLabels[category].toLowerCase()}`,
        description: null,
        target_value: null,
        current_value: 0,
        unit: null,
      });
      router.push(`/goal/${goal.id}?edit=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add goal");
    } finally {
      setCreatingGoalCategory(null);
    }
  }

  async function handleCompleteTask(task: GoalTask) {
    setCompletingTaskId(task.id);
    setError(null);
    try {
      await completeGoalTask(task.id);
      setMessage("Task logged as complete.");
      await loadGoals();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete task");
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleRestoreCompletion(completionId: string) {
    setRestoringCompletionId(completionId);
    setError(null);
    try {
      await restoreCompletedGoal(completionId);
      setMessage("Moved back to the task list.");
      await loadGoals();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore completed task");
    } finally {
      setRestoringCompletionId(null);
    }
  }

  async function handleTaskSave(taskId: string, changes: TaskUpdate) {
    await updateTask(taskId, changes);
    await loadGoals();
    setMessage("Objective updated.");
  }

  function toggleTaskExpanded(taskId: string) {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function handleSplitTask(task: GoalTask) {
    setSplittingTaskId(task.id);
    setSplitErrors((current) => {
      if (!(task.id in current)) return current;
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    try {
      await breakdownGoalTask(task.id);
      await loadGoals();
    } catch (err) {
      setSplitErrors((current) => ({
        ...current,
        [task.id]: err instanceof Error ? err.message : "Could not split task",
      }));
    } finally {
      setSplittingTaskId(null);
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim() || isSavingProject) return;

    setIsSavingProject(true);
    setError(null);
    try {
      await createProject({
        name: projectName.trim(),
        description: projectDescription.trim() || null,
        type: projectType,
        linked_goal_ids: projectGoalIds,
      });
      await loadGoals();
      setProjectName("");
      setProjectDescription("");
      setProjectType(readProjectBehaviorSettings().defaultProjectType);
      setProjectGoalIds([]);
      setIsCreateProjectOpen(false);
      setMessage("Mission initialized.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create mission");
    } finally {
      setIsSavingProject(false);
    }
  }

  function openCreateProject() {
    setProjectType(readProjectBehaviorSettings().defaultProjectType);
    setIsCreateProjectOpen(true);
  }

  function openAddTask() {
    const defaults = readProjectBehaviorSettings();
    const generalWorkProject = projects.find((project) => project.name.trim().toLowerCase() === "general work");
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskProjectId(generalWorkProject?.id ?? projects[0]?.id ?? "");
    setNewTaskPriority(defaults.defaultTaskPriority);
    setNewTaskImportance(3);
    setNewTaskEta(String(defaults.defaultTaskMinutes));
    setNewTaskDeadline("");
    setIsAddTaskOpen(true);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTaskTitle.trim() || !newTaskProjectId || isSavingTask) return;

    setIsSavingTask(true);
    setError(null);
    try {
      await createTask({
        project_id: newTaskProjectId,
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || null,
        status: readProjectBehaviorSettings().defaultTaskStatus,
        priority: newTaskPriority,
        importance_rating: newTaskImportance,
        completion_percentage: 0,
        eta_hours: Math.round(((Number(newTaskEta) || 0) / 60) * 100) / 100,
        time_spent_hours: 0,
        start_date: null,
        deadline: newTaskDeadline ? new Date(newTaskDeadline).toISOString() : null,
      });
      await loadGoals();
      setIsAddTaskOpen(false);
      setMessage("Objective added to the queue.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task");
    } finally {
      setIsSavingTask(false);
    }
  }

  return (
    <main className="ops-screen">
      <section className="ops-header mission-control-header">
        <div className="mission-header-title">
          <h1>Mission Control</h1>
          <p className="ops-subtitle">Mission queue and campaign planning horizons.</p>
        </div>
        <div className="ops-header-actions">
          <Metric label="Open Tasks" value={openTaskCount} />
          <Metric label="Req Time To Complete All" value={formatRequiredTime(requiredMinutes)} />
          <button type="button" onClick={openCreateProject} className="ops-button primary">
            New Mission
          </button>
        </div>
      </section>

      <div className="ops-grid">
        {error ? <p className="ops-alert danger span-12">{error}</p> : null}
        {message ? <p className="ops-alert signal span-12">{message}</p> : null}

        <div id="schedule" className="span-12 mission-control-schedule">
          <TimelinePage embedded />
        </div>

        <section className="ops-panel span-12">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="ops-kicker">MISSION QUEUE</p>
              <h2 className="mt-1 text-lg font-semibold">Active Objectives</h2>
            </div>
            <button type="button" onClick={openAddTask} disabled={isLoading} className="ops-button primary">
              Add Task
            </button>
          </div>

          <div className="task-tree mt-4">
            {isLoading ? (
              [0, 1, 2].map((item) => <div key={item} className="task-tree-skeleton" />)
            ) : sortedTaskTree.length ? (
              sortedTaskTree.map((node, index) => (
                <div key={node.id} className={index > 0 ? "task-tree-main-divider" : undefined}>
                  <TaskTreeRow
                    node={node}
                    depth={0}
                    collapsedIds={collapsedTaskIds}
                    onToggleExpand={toggleTaskExpanded}
                    onComplete={handleCompleteTask}
                    completingTaskId={completingTaskId}
                    onSplit={handleSplitTask}
                    splittingTaskId={splittingTaskId}
                    splitErrors={splitErrors}
                    onOpenTask={setEditingTask}
                  />
                </div>
              ))
            ) : (
              <div className="task-tree-empty">
                <h3>No active objectives</h3>
                <p>Use the fixed logger below with a + prefix to add one.</p>
              </div>
            )}
          </div>
        </section>

        <div className="span-12">
          <CompletionTrendSection
            isLoading={isCompletionTrendLoading}
            metric={completionTrendMetric}
            range={completionTrendRange}
            setMetric={setCompletionTrendMetric}
            setRange={setCompletionTrendRange}
            trend={completionTrend}
          />
        </div>

        <section className="ops-panel span-12">
          <p className="ops-kicker">RECENTLY COMPLETED OBJECTIVES</p>
          <h2 className="mt-1 text-lg font-semibold">Mission Completion Log</h2>
          <div className="mt-4 overflow-hidden rounded-md border border-stone-200 bg-white">
            {(overview?.recent_completed_tasks ?? []).length ? (
              <>
                <div className="hidden grid-cols-[32px_minmax(0,1fr)_minmax(120px,0.65fr)_128px] gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500 md:grid">
                  <span />
                  <span>Task</span>
                  <span>Mission</span>
                  <span>Completed</span>
                </div>
                {overview?.recent_completed_tasks.map((item) => (
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
                    className={`grid gap-1 border-b border-stone-100 px-3 py-2 text-xs transition last:border-b-0 hover:bg-teal-50/35 md:grid-cols-[32px_minmax(0,1fr)_minmax(120px,0.65fr)_128px] md:items-center md:gap-3 ${item.task ? "cursor-pointer" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={restoringCompletionId !== item.id}
                      disabled={restoringCompletionId === item.id}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        if (!event.target.checked) void handleRestoreCompletion(item.id);
                      }}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-teal-600"
                      aria-label={`Move ${item.title} back to task list`}
                    />
                    <p className="min-w-0 truncate font-semibold text-stone-950">{item.title}</p>
                    <span className="min-w-0 truncate text-amber-800">{item.goal_label}</span>
                    <span className="text-stone-500">{formatDate(item.created_at)}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="bg-stone-50 p-3 text-xs text-stone-600">No completed work logged yet. Use a - prefix below when you finish something.</p>
            )}
          </div>
        </section>

        <section className="span-12 grid gap-4 md:grid-cols-2">
          {categoryOrder.map((category) => (
            <GoalCategorySection
              key={category}
              category={category}
              goals={goalsByCategory[category]}
              isCreating={creatingGoalCategory === category}
              onCreate={() => handleCreateGoal(category)}
            />
          ))}
        </section>
      </div>

      {isCreateProjectOpen ? (
        <div className="mission-modal-backdrop">
          <form onSubmit={handleCreateProject} className="mission-control-modal">
            <div className="mission-modal-head">
              <div>
                <p className="ops-kicker">MISSION REGISTRY</p>
                <h2>Initialize Mission</h2>
              </div>
              <button type="button" onClick={() => setIsCreateProjectOpen(false)} className="mission-modal-close" aria-label="Close">
                x
              </button>
            </div>

            <label className="mission-modal-field" htmlFor="project-name">
              Mission name
              <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} autoFocus />
            </label>

            <label className="mission-modal-field" htmlFor="project-description">
              Mission description
              <textarea
                id="project-description"
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                rows={4}
                placeholder="Describe the work that belongs here so AI can allocate tasks correctly."
              />
            </label>

            <fieldset className="mission-modal-field">
              <legend>Parent goals (optional)</legend>
              <div className="mission-goal-options">
                {(overview?.goals ?? []).map((goal) => (
                  <label key={goal.id}>
                    <input
                      type="checkbox"
                      checked={projectGoalIds.includes(goal.id)}
                      onChange={() =>
                        setProjectGoalIds((current) =>
                          current.includes(goal.id)
                            ? current.filter((goalId) => goalId !== goal.id)
                            : [...current, goal.id],
                        )
                      }
                    />
                    <span>{goal.title}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mission-type-grid">
              {projectTypes.map((item) => (
                <button key={item.value} type="button" onClick={() => setProjectType(item.value)} className={projectType === item.value ? "mission-type-choice active" : "mission-type-choice"}>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>

            <div className="mission-modal-actions">
              <button type="button" onClick={() => setIsCreateProjectOpen(false)} className="ops-button">
                Cancel
              </button>
              <button disabled={isSavingProject || !projectName.trim()} className="ops-button primary">
                {isSavingProject ? "Creating..." : "Create Mission"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isAddTaskOpen ? (
        <div className="mission-modal-backdrop">
          <form onSubmit={handleCreateTask} className="mission-control-modal">
            <div className="mission-modal-head">
              <div>
                <p className="ops-kicker">MISSION QUEUE</p>
                <h2>Add Task</h2>
              </div>
              <button type="button" onClick={() => setIsAddTaskOpen(false)} className="mission-modal-close" aria-label="Close">
                x
              </button>
            </div>

            <label className="mission-modal-field" htmlFor="task-title">
              Task title
              <input id="task-title" value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} autoFocus />
            </label>

            <label className="mission-modal-field" htmlFor="task-description">
              Description
              <textarea
                id="task-description"
                value={newTaskDescription}
                onChange={(event) => setNewTaskDescription(event.target.value)}
                rows={3}
                placeholder="Notes, acceptance details, or context"
              />
            </label>

            <label className="mission-modal-field" htmlFor="task-project">
              Mission
              <select id="task-project" value={newTaskProjectId} onChange={(event) => setNewTaskProjectId(event.target.value)}>
                {projects.length === 0 ? <option value="">No missions available</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mission-task-grid">
              <label className="mission-modal-field" htmlFor="task-priority">
                Priority
                <select id="task-priority" value={newTaskPriority} onChange={(event) => setNewTaskPriority(event.target.value as TaskPriority)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>

              <label className="mission-modal-field" htmlFor="task-importance">
                Importance (1-5)
                <select id="task-importance" value={newTaskImportance} onChange={(event) => setNewTaskImportance(Number(event.target.value))}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mission-modal-field" htmlFor="task-eta">
                ETA (minutes)
                <input
                  id="task-eta"
                  type="number"
                  min="0"
                  step="5"
                  value={newTaskEta}
                  onChange={(event) => setNewTaskEta(event.target.value)}
                />
              </label>

              <label className="mission-modal-field" htmlFor="task-deadline">
                Deadline (optional)
                <input id="task-deadline" type="date" value={newTaskDeadline} onChange={(event) => setNewTaskDeadline(event.target.value)} />
              </label>
            </div>

            <div className="mission-modal-actions">
              <button type="button" onClick={() => setIsAddTaskOpen(false)} className="ops-button">
                Cancel
              </button>
              <button disabled={isSavingTask || !newTaskTitle.trim() || !newTaskProjectId} className="ops-button primary">
                {isSavingTask ? "Adding..." : "Add Task"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <TaskEditor task={editingTask} onClose={() => setEditingTask(null)} onSave={handleTaskSave} />
    </main>
  );
}

function GoalCategorySection({
  category,
  goals,
  isCreating,
  onCreate,
}: {
  category: GoalCategory;
  goals: Goal[];
  isCreating: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="ops-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="ops-kicker">{categoryLabels[category]}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded border border-stone-200 bg-teal-50 text-xs font-semibold text-teal-800">
            {goals.length}
          </span>
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-teal-300 hover:text-teal-800 disabled:cursor-not-allowed disabled:text-stone-300"
          >
            {isCreating ? "Adding..." : "Add Mission"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {goals.length ? (
          goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
            />
          ))
        ) : (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-left text-xs font-semibold text-stone-600 transition hover:border-teal-300 hover:bg-teal-50/40 hover:text-teal-800"
          >
            Initialize first {categoryLabels[category].toLowerCase()}.
          </button>
        )}
      </div>
    </div>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  return (
    <Link href={`/goal/${goal.id}`} className="group block rounded-lg border border-stone-200 bg-white p-3 text-left transition hover:border-teal-200 hover:bg-teal-50/30">
      <h3 className="text-sm font-semibold leading-5 text-stone-950">{goal.title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-stone-600">
        {goal.description || "No why captured yet. Open this goal to define it."}
      </p>
      {goal.measurable && goal.progress_percentage != null ? (
        <div className="mt-2.5">
          <div className="flex justify-between text-[11px] font-semibold text-stone-500">
            <span>
              {formatNumber(goal.current_value)} / {formatNumber(goal.target_value ?? 0)} {goal.unit}
            </span>
            <span>{goal.progress_percentage}%</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-stone-100">
            <div className="h-1.5 rounded-full bg-gradient-to-r from-teal-500 to-lime-500" style={{ width: `${goal.progress_percentage}%` }} />
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between text-xs font-medium text-stone-500">
          <span>{goal.linked_projects.length} attached project{goal.linked_projects.length === 1 ? "" : "s"}</span>
          <span className="text-stone-950 transition group-hover:translate-x-1">Open</span>
        </div>
      )}
    </Link>
  );
}

type TaskTreeNode = GoalTask & { children: TaskTreeNode[] };

function buildTaskTree(tasks: GoalTask[]): TaskTreeNode[] {
  const byId = new Map<string, TaskTreeNode>();
  tasks.forEach((task) => byId.set(task.id, { ...task, children: [] }));
  const roots: TaskTreeNode[] = [];
  tasks.forEach((task) => {
    const node = byId.get(task.id);
    if (!node) return;
    const parent = task.parent_task_id ? byId.get(task.parent_task_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

function TaskTreeRow({
  node,
  depth,
  collapsedIds,
  onToggleExpand,
  onComplete,
  completingTaskId,
  onSplit,
  splittingTaskId,
  splitErrors,
  onOpenTask,
}: {
  node: TaskTreeNode;
  depth: number;
  collapsedIds: Set<string>;
  onToggleExpand: (taskId: string) => void;
  onComplete: (task: GoalTask) => void;
  completingTaskId: string | null;
  onSplit: (task: GoalTask) => void;
  splittingTaskId: string | null;
  splitErrors: Record<string, string>;
  onOpenTask: (task: GoalTask) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isDone = node.status === "done";
  const isExpanded = !collapsedIds.has(node.id);
  const isSplitting = splittingTaskId === node.id;
  const splitError = splitErrors[node.id];

  return (
    <div>
      <div className="task-tree-row" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        <span className="task-tree-leading">
          {hasChildren ? (
            <button
              type="button"
              className="task-tree-toggle"
              onClick={() => onToggleExpand(node.id)}
              aria-label={isExpanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : isDone ? (
            <span className="task-tree-spacer" />
          ) : (
            <input
              type="checkbox"
              className="task-tree-checkbox"
              disabled={completingTaskId === node.id}
              onChange={() => onComplete(node)}
              aria-label={`Mark ${node.title} complete`}
            />
          )}
        </span>
        <p
          className={isDone ? "task-tree-title done" : "task-tree-title"}
          role="button"
          tabIndex={0}
          onClick={() => onOpenTask(node)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onOpenTask(node);
          }}
        >
          {node.title}
        </p>
        <span className="task-tree-time">{formatRequiredTime(node.time_required_minutes)}</span>
        {isDone ? (
          <span className="task-tree-check" aria-hidden>
            {"✓"}
          </span>
        ) : hasChildren ? (
          <span className="task-tree-spacer" />
        ) : (
          <button
            type="button"
            className="task-tree-split"
            onClick={() => onSplit(node)}
            disabled={isSplitting}
            aria-label={`Split ${node.title}`}
          >
            {isSplitting ? "⋯" : "+"}
          </button>
        )}
      </div>
      {splitError ? <p className="task-tree-error">{splitError}</p> : null}
      {hasChildren && isExpanded ? (
        <div className="task-tree-children">
          {node.children.map((child) => (
            <TaskTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsedIds={collapsedIds}
              onToggleExpand={onToggleExpand}
              onComplete={onComplete}
              completingTaskId={completingTaskId}
              onSplit={onSplit}
              splittingTaskId={splittingTaskId}
              splitErrors={splitErrors}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type CompletionTrendMetric = "tasks" | "minutes";

type CompletionTrendChartPoint = {
  value: number;
  label: string;
  shortLabel: string;
};

const completionTrendRangeLabels: Record<CaptainCompassContextDays, string> = {
  7: "7 Days",
  30: "30 Days",
  90: "90 Days",
};

const completionTrendMetricLabels: Record<CompletionTrendMetric, string> = {
  tasks: "Tasks Completed",
  minutes: "Minutes Worked",
};

function CompletionTrendSection({
  isLoading,
  metric,
  range,
  setMetric,
  setRange,
  trend,
}: {
  isLoading: boolean;
  metric: CompletionTrendMetric;
  range: CaptainCompassContextDays;
  setMetric: (metric: CompletionTrendMetric) => void;
  setRange: (range: CaptainCompassContextDays) => void;
  trend: GoalCompletionTrend | null;
}) {
  const points: CompletionTrendChartPoint[] = useMemo(() => {
    return (trend?.points ?? []).map((point) => {
      const date = new Date(`${point.date}T00:00:00`);
      return {
        value: metric === "tasks" ? point.tasks_completed : point.minutes_worked,
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        shortLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      };
    });
  }, [trend, metric]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Mission Output</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">Daily Completion Trend</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-full border border-stone-200 bg-stone-100 p-1">
            {(["tasks", "minutes"] as CompletionTrendMetric[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMetric(option)}
                className={`inline-flex h-7 min-w-[8.5rem] items-center justify-center rounded-full px-3 text-xs font-semibold transition ${
                  metric === option ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white hover:text-stone-950"
                }`}
              >
                {completionTrendMetricLabels[option]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {([7, 30, 90] as CaptainCompassContextDays[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                className={`inline-flex h-8 min-w-[5.75rem] items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                  range === option ? "border-stone-950 bg-stone-950 text-white shadow-sm" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50"
                }`}
              >
                {completionTrendRangeLabels[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <LineTrendChart
        ariaLabel={`${completionTrendMetricLabels[metric]} Over The Last ${range} Days`}
        emptyMessage="No completed objectives logged in this range yet."
        getLabel={(point) => point.label}
        getShortLabel={(point) => point.shortLabel}
        getValue={(point) => point.value}
        isLoading={isLoading}
        maxLabels={range === 7 ? 7 : 10}
        minY={metric === "tasks" ? 5 : 25}
        points={points}
        tickStep={metric === "tasks" ? 1 : 25}
      />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="system-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getRemainingTaskMinutes(task: GoalTask) {
  return Math.max(0, Math.round(task.time_required_minutes * (1 - task.completion_percentage / 100)));
}

function formatRequiredTime(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
