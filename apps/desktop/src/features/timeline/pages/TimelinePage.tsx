"use client";

import Link from "next/link";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { TaskEditor } from "@/components/TaskEditor";
import {
  getProjectTasks,
  getProjects,
  updateTask,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskUpdate,
} from "@/lib/api";
import "./TimelinePage.css";

type TimelineView = "3day" | "week" | "month";
type TimelineStatusFilter = "all" | "active" | "incomplete" | "in_progress" | "done";
type TimelinePriorityFilter = "all" | TaskPriority;

type TimelineTask = {
  id: string;
  raw: Task;
  title: string;
  projectName: string;
  status: TaskStatus;
  priority: TaskPriority;
  etaHours: number;
  timeSpentHours: number;
  startDate: Date | null;
  createdAt: Date;
  deadline: Date | null;
};

type ProjectWithTasks = {
  project: Project;
  tasks: Task[];
};

const dayMs = 86_400_000;

const viewOptions: Record<TimelineView, { label: string; days: number; columnWidth: number }> = {
  "3day": { label: "3 day", days: 3, columnWidth: 176 },
  week: { label: "Week", days: 7, columnWidth: 112 },
  month: { label: "Month", days: 30, columnWidth: 44 },
};

export default function TimelinePage({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<ProjectWithTasks[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TimelineView>("week");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TimelineStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TimelinePriorityFilter>("all");
  const [maxRequiredMinutes, setMaxRequiredMinutes] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function loadTimeline() {
      setError(null);
      const projects = await getProjects();
      const taskGroups = await Promise.all(projects.map((project) => getProjectTasks(project.id)));

      setItems(projects.map((project, index) => ({ project, tasks: taskGroups[index] ?? [] })));
    }

    loadTimeline()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  const today = useMemo(() => startOfDay(currentTime), [currentTime]);
  const timelineTasks = useMemo(
    () =>
      items.flatMap((item) => item.tasks.map((task) => toTimelineTask(task, item.project.name))),
    [items],
  );

  const visibleTasks = useMemo(() => {
    const maximumMinutes = Number(maxRequiredMinutes);

    return timelineTasks.filter((task) => {
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isTaskActiveOn(task, today)) ||
        (statusFilter === "incomplete" && task.status !== "done") ||
        task.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      const matchesRequiredTime =
        !maxRequiredMinutes || !Number.isFinite(maximumMinutes) || Math.round(task.etaHours * 60) <= maximumMinutes;

      return matchesStatus && matchesPriority && matchesRequiredTime;
    });
  }, [maxRequiredMinutes, priorityFilter, statusFilter, timelineTasks, today]);
  const timelineDates = useMemo(() => buildTimelineDates(visibleTasks, today, viewOptions[view].days), [today, view, visibleTasks]);
  const groupedTasks = groupTasksByProject(visibleTasks);
  const totalPlanned = timelineTasks.reduce((sum, task) => sum + task.etaHours, 0);
  const totalSpent = timelineTasks.reduce((sum, task) => sum + task.timeSpentHours, 0);
  const totalPlannedMinutes = Math.round(totalPlanned * 60);
  const totalSpentMinutes = Math.round(totalSpent * 60);
  const completedTasks = timelineTasks.filter((task) => task.status === "done").length;
  const efficiency = totalPlanned === 0 ? 0 : Math.round((totalSpent / totalPlanned) * 100);
  const completionRate = timelineTasks.length === 0 ? 0 : Math.round((completedTasks / timelineTasks.length) * 100);
  const columnWidth = viewOptions[view].columnWidth;
  const timelineWidth = timelineDates.length * columnWidth;
  const currentTimeOffset = getDayDifference(today, timelineDates[0]) * columnWidth + getDayProgress(currentTime) * columnWidth;
  const currentTimeLabel = currentTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const timeAllocation = buildTimeAllocation(timelineTasks);
  const fixedProjects = items.filter((item) => item.project.type === "fixed");
  const continuousProjects = items.filter((item) => item.project.type === "continuous");
  const activeFilterCount =
    Number(statusFilter !== "all") + Number(priorityFilter !== "all") + Number(Boolean(maxRequiredMinutes));

  function recalibrateToToday() {
    scrollerRef.current?.scrollTo({ left: Math.max(currentTimeOffset - 24, 0), behavior: "smooth" });
  }

  async function handleDeadlineChange(taskId: string, deadline: Date) {
    const nextDeadline = endOfDay(deadline).toISOString();
    const previousItems = items;

    setItems((currentItems) => updateTaskInItems(currentItems, taskId, { deadline: nextDeadline }));
    setError(null);

    try {
      await updateTask(taskId, { deadline: nextDeadline });
    } catch (err) {
      setItems(previousItems);
      setError(err instanceof Error ? err.message : "Could not update task deadline");
    }
  }

  async function handleTaskSave(taskId: string, changes: TaskUpdate) {
    const updated = await updateTask(taskId, changes);
    setItems((currentItems) => updateTaskInItems(currentItems, taskId, updated));
    setEditingTask((current) => (current?.id === taskId ? updated : current));
  }

  const Container = embedded ? "section" : "main";

  return (
    <Container className={embedded ? "mission-schedule-embedded" : "ops-screen"}>
      {embedded ? (
        <div className="mission-schedule-embedded-head">
          <div>
            <p className="ops-kicker">MISSION SCHEDULE</p>
            <h2>Operations Schedule</h2>
            <p>Weekly planning, timeline control, queue state, and time allocation.</p>
          </div>
        </div>
      ) : (
      <header className="ops-header">
        <div>
          <p className="ops-kicker">MISSION SCHEDULE</p>
          <h1>Mission Schedule</h1>
          <p className="ops-subtitle">Operations planning board, queue state, time allocation, and efficiency report.</p>
        </div>
        <Link
          href="/"
          className="ops-button primary"
        >
          Add Objective
        </Link>
      </header>
      )}

      {error ? <p className="ops-alert danger">{error}</p> : null}

      <section className="mt-4 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="ops-panel timeline-plan">
          <div className="timeline-plan-head">
            <div>
              <h2>{viewOptions[view].label} Operations Plan</h2>
              <p>{visibleTasks.length} visible tasks across {items.length} projects</p>
            </div>
            <div className="timeline-controls">
              <div className="timeline-view-switcher">
                {(Object.keys(viewOptions) as TimelineView[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setView(option)}
                    className={view === option ? "active" : ""}
                  >
                    {viewOptions[option].label}
                  </button>
                ))}
              </div>
              <div className="timeline-filter-menu">
                <button
                  type="button"
                  onClick={() => setIsFilterOpen((current) => !current)}
                  className={activeFilterCount ? "timeline-filter-button active" : "timeline-filter-button"}
                  aria-expanded={isFilterOpen}
                >
                  Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
                </button>
                {isFilterOpen ? (
                  <div className="timeline-filter-popover">
                    <label>
                      <span>Status</span>
                      <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as TimelineStatusFilter)}
                      >
                        <option value="all">All</option>
                        <option value="active">Active today</option>
                        <option value="incomplete">Incomplete</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                    </label>
                    <label>
                      <span>Priority</span>
                      <select
                        value={priorityFilter}
                        onChange={(event) => setPriorityFilter(event.target.value as TimelinePriorityFilter)}
                      >
                        <option value="all">All priorities</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                    <label>
                      <span>Time required up to</span>
                      <div className="timeline-minute-input">
                        <input
                          type="number"
                          min="0"
                          step="5"
                          value={maxRequiredMinutes}
                          onChange={(event) => setMaxRequiredMinutes(event.target.value)}
                          placeholder="Any"
                        />
                        <strong>min</strong>
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("all");
                        setPriorityFilter("all");
                        setMaxRequiredMinutes("");
                      }}
                      className="timeline-filter-clear"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={recalibrateToToday}
                className="timeline-today-button"
              >
                Today
              </button>
            </div>
          </div>

          {isLoading ? <p className="timeline-message">Loading timeline...</p> : null}

          {!isLoading && timelineTasks.length === 0 ? (
            <div className="timeline-message">
              <strong>No tasks yet</strong>
              <p>Create tasks inside a project and they will appear here automatically.</p>
            </div>
          ) : null}

          {!isLoading && timelineTasks.length > 0 && visibleTasks.length === 0 ? (
            <div className="timeline-message">
              <strong>No tasks match these filters</strong>
              <p>Clear or adjust the filters to see more of the schedule.</p>
            </div>
          ) : null}

          {!isLoading && visibleTasks.length > 0 ? (
            <div ref={scrollerRef} className="timeline-scroller">
              <div className="min-w-full" style={{ width: 260 + timelineWidth }}>
                <div className="timeline-grid timeline-grid-head">
                  <div className="timeline-task-column">Tasks</div>
                  <TimelineGrid
                    columnWidth={columnWidth}
                    dates={timelineDates}
                    timelineWidth={timelineWidth}
                    currentTimeLabel={currentTimeLabel}
                    currentTimeOffset={currentTimeOffset}
                  />
                </div>

                {groupedTasks.map(([projectName, projectTasks]) => (
                  <div key={projectName}>
                    <div className="timeline-grid timeline-project-row">
                      <div>{projectName}</div>
                      <TimelineGrid
                        columnWidth={columnWidth}
                        compact
                        dates={timelineDates}
                        timelineWidth={timelineWidth}
                        currentTimeOffset={currentTimeOffset}
                      />
                    </div>

                    {projectTasks.map((task) => (
                      <TimelineRow
                        key={task.id}
                        columnWidth={columnWidth}
                        dates={timelineDates}
                        onDeadlineChange={handleDeadlineChange}
                        onEdit={setEditingTask}
                        task={task}
                        timelineWidth={timelineWidth}
                        currentTimeOffset={currentTimeOffset}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="grid gap-4">
          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Efficiency Report</h2>
              <span>{efficiency}% invested/planned</span>
            </div>
            <div className="timeline-text-list">
              <SummaryMetric label="Planned Hours" value={`${(totalPlannedMinutes / 60).toFixed(1)}h`} />
              <SummaryMetric label="Actual Hours" value={`${(totalSpentMinutes / 60).toFixed(1)}h`} />
              <SummaryMetric label="Completion Rate" value={`${completionRate}%`} />
            </div>
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Time Allocation</h2>
              <span>mission categories</span>
            </div>
            <div className="timeline-text-list">
              {timeAllocation.map((item) => (
                <SummaryMetric key={item.label} label={item.label} value={`${item.minutes}m / ${item.percent}%`} />
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="timeline-project-register">
        <ProjectRegister title="Fixed Projects" items={fixedProjects} emptyText="No fixed projects" />
        <ProjectRegister title="Continuous Projects" items={continuousProjects} emptyText="No continuous projects" />
      </section>

      <TaskEditor task={editingTask} onClose={() => setEditingTask(null)} onSave={handleTaskSave} />
    </Container>
  );

}

function TimelineGrid({
  columnWidth,
  compact = false,
  currentTimeLabel,
  currentTimeOffset,
  dates,
  timelineWidth,
}: {
  columnWidth: number;
  compact?: boolean;
  currentTimeLabel?: string;
  currentTimeOffset: number;
  dates: Date[];
  timelineWidth: number;
}) {
  return (
    <div className="relative" style={{ width: timelineWidth }}>
      <div className="timeline-current-time" style={{ left: currentTimeOffset }}>
        {currentTimeLabel ? (
          <span>{currentTimeLabel}</span>
        ) : null}
      </div>
      <div className="flex">
        {dates.map((date) => (
          <div
            key={date.toISOString()}
            className={`timeline-date-column ${compact ? "compact" : ""}`}
            style={{ width: columnWidth }}
          >
            {!compact ? (
              <>
                <p>
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </p>
                <strong>
                  {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </strong>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({
  columnWidth,
  dates,
  onDeadlineChange,
  onEdit,
  task,
  timelineWidth,
  currentTimeOffset,
}: {
  columnWidth: number;
  dates: Date[];
  onDeadlineChange: (taskId: string, deadline: Date) => Promise<void>;
  onEdit: (task: Task) => void;
  task: TimelineTask;
  timelineWidth: number;
  currentTimeOffset: number;
}) {
  const [dragDays, setDragDays] = useState<number | null>(null);
  const dragStartRef = useRef<{ clientX: number; baseDays: number; minDays: number } | null>(null);
  const dragDaysRef = useRef<number | null>(null);
  const progress = getTaskProgress(task);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const taskStart = maxDate(startOfDay(task.startDate ?? task.createdAt), firstDate);
  const taskEnd = minDate(startOfDay(task.deadline ?? getEstimatedEndDate(task)), lastDate);
  const startIndex = Math.max(0, getDayDifference(taskStart, firstDate));
  const baseDuration = Math.max(1, getDayDifference(taskEnd, taskStart) + 1);
  const duration = dragDays ?? baseDuration;
  const left = startIndex * columnWidth + 12;
  const width = Math.max(duration * columnWidth - 24, 28);
  const currentDeadline = task.deadline ? startOfDay(task.deadline) : taskEnd;
  const currentDurationFromStart = Math.max(1, getDayDifference(currentDeadline, taskStart) + 1);
  const visibleRangeEnded = task.deadline ? startOfDay(task.deadline) < firstDate : false;

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      clientX: event.clientX,
      baseDays: currentDurationFromStart,
      minDays: 1,
    };
    dragDaysRef.current = currentDurationFromStart;
    setDragDays(currentDurationFromStart);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragStartRef.current) return;
    const dragDeltaDays = Math.round((event.clientX - dragStartRef.current.clientX) / columnWidth);
    const nextDuration = Math.max(dragStartRef.current.minDays, dragStartRef.current.baseDays + dragDeltaDays);
    const rangeDuration = getDayDifference(lastDate, taskStart) + 1;
    const nextDragDays = Math.min(nextDuration, rangeDuration);
    dragDaysRef.current = nextDragDays;
    setDragDays(nextDragDays);
  }

  async function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!dragStartRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const nextDuration = dragDaysRef.current ?? dragStartRef.current.baseDays;
    dragStartRef.current = null;
    dragDaysRef.current = null;
    setDragDays(null);

    if (nextDuration !== currentDurationFromStart) {
      await onDeadlineChange(task.id, addDays(taskStart, nextDuration - 1));
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(task.raw)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onEdit(task.raw);
      }}
      className="timeline-grid timeline-task-row"
    >
      <div className="timeline-task-details">
        <span className={`timeline-status-mark ${task.status}`} />
        <div className="min-w-0">
          <p>{task.title}</p>
          <span>
            {Math.round(task.timeSpentHours * 60)} min invested / {Math.round(task.etaHours * 60)} min ETA
          </span>
        </div>
      </div>
      <div className="relative min-h-16" style={{ width: timelineWidth }}>
        <div className="timeline-current-time" style={{ left: currentTimeOffset }} />
        <div className="absolute inset-0 flex">
          {dates.map((date) => (
            <div key={date.toISOString()} className="timeline-date-column compact" style={{ width: columnWidth }} />
          ))}
        </div>
        {!visibleRangeEnded ? (
          <div
            className={`timeline-task-track ${task.status}`}
            style={{ left, width }}
          >
            <div className="timeline-task-fill" style={{ width: `${progress}%` }} />
            <div className="timeline-task-percent">{progress}%</div>
            <button
              type="button"
              aria-label={`Adjust deadline for ${task.title}`}
              title="Drag to adjust deadline"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onPointerCancel={() => {
                dragStartRef.current = null;
                dragDaysRef.current = null;
                setDragDays(null);
              }}
              className="timeline-deadline-handle"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="timeline-text-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectRegister({
  emptyText,
  items,
  title,
}: {
  emptyText: string;
  items: ProjectWithTasks[];
  title: string;
}) {
  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <h2>{title}</h2>
        <span>{items.length} projects</span>
      </div>
      <div className="timeline-project-list">
        {items.length === 0 ? <p className="ops-empty compact">{emptyText}</p> : null}
        {items.map(({ project, tasks }) => {
          const completed = tasks.filter((task) => task.status === "done").length;
          const active = tasks.filter((task) => task.status === "in_progress").length;
          const investedMinutes = Math.round(tasks.reduce((sum, task) => sum + task.time_spent_hours, 0) * 60);

          return (
            <Link key={project.id} href={`/project/${project.id}`} className="timeline-project-link">
              <strong>{project.name}</strong>
              <span>{tasks.length} tasks</span>
              <span>{active} active</span>
              <span>{completed} done</span>
              <span>{investedMinutes}m invested</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function buildTimeAllocation(tasks: TimelineTask[]) {
  const buckets = [
    { label: "Learning", match: /learn|course|study|chapter|read/i },
    { label: "Building", match: /build|ship|code|feature|project|fix/i },
    { label: "Reading", match: /read|book|chapter/i },
    { label: "Health", match: /workout|health|run|gym|sleep|calorie/i },
    { label: "Work", match: /work|client|meeting|review|email/i },
  ];
  const totals = buckets.map((bucket) => ({
    label: bucket.label,
    minutes: tasks
      .filter((task) => bucket.match.test(`${task.title} ${task.projectName}`))
      .reduce((sum, task) => sum + Math.round(task.etaHours * 60), 0),
  }));
  const fallbackMinutes = Math.max(0, tasks.reduce((sum, task) => sum + Math.round(task.etaHours * 60), 0) - totals.reduce((sum, item) => sum + item.minutes, 0));
  if (fallbackMinutes > 0 && totals[4]) totals[4].minutes += fallbackMinutes;
  const max = Math.max(...totals.map((item) => item.minutes), 1);
  return totals.map((item) => ({ ...item, percent: Math.round((item.minutes / max) * 100) }));
}

function toTimelineTask(task: Task, projectName: string): TimelineTask {
  return {
    id: task.id,
    raw: task,
    title: task.title,
    projectName,
    status: task.status,
    priority: task.priority,
    etaHours: task.eta_hours,
    timeSpentHours: task.time_spent_hours,
    startDate: task.start_date ? new Date(task.start_date) : null,
    createdAt: new Date(task.created_at),
    deadline: task.deadline ? new Date(task.deadline) : null,
  };
}

function getTaskProgress(task: TimelineTask) {
  if (task.status === "done") return 100;
  if (task.etaHours <= 0) return task.timeSpentHours > 0 ? 100 : 0;
  return Math.min(Math.round((task.timeSpentHours / task.etaHours) * 100), 100);
}

function buildTimelineDates(tasks: TimelineTask[], today: Date, visibleDays: number) {
  const lastDeadline = tasks.reduce<Date | null>((latest, task) => {
    const taskEnd = task.deadline ?? getEstimatedEndDate(task);
    return latest && latest > taskEnd ? latest : taskEnd;
  }, null);
  const endDate = maxDate(addDays(today, visibleDays - 1), addDays(startOfDay(lastDeadline ?? today), 2));
  const totalDays = getDayDifference(endDate, today) + 1;

  return Array.from({ length: totalDays }, (_, index) => addDays(today, index));
}

function getEstimatedEndDate(task: TimelineTask) {
  return addDays(startOfDay(task.startDate ?? task.createdAt), Math.max(0, Math.ceil(task.etaHours / 4) - 1));
}

function isTaskActiveOn(task: TimelineTask, date: Date) {
  if (task.status === "done") return false;

  const taskStart = startOfDay(task.startDate ?? task.createdAt);
  const taskEnd = task.deadline ? startOfDay(task.deadline) : getEstimatedEndDate(task);

  return taskStart <= date && taskEnd >= date;
}

function groupTasksByProject(items: TimelineTask[]) {
  return items.reduce<[string, TimelineTask[]][]>((groups, task) => {
    const group = groups.find(([projectName]) => projectName === task.projectName);

    if (group) {
      group[1].push(task);
      return groups;
    }

    return [...groups, [task.projectName, [task]]];
  }, []);
}

function updateTaskInItems(items: ProjectWithTasks[], taskId: string, changes: Partial<Task>) {
  return items.map((item) => ({
    ...item,
    tasks: item.tasks.map((task) => (task.id === taskId ? { ...task, ...changes } : task)),
  }));
}

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function endOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return startOfDay(nextDate);
}

function getDayDifference(end: Date, start: Date) {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / dayMs);
}

function getDayProgress(date: Date) {
  return (date.getHours() * 60 + date.getMinutes()) / (24 * 60);
}

function minDate(first: Date, second: Date) {
  return first < second ? first : second;
}

function maxDate(first: Date, second: Date) {
  return first > second ? first : second;
}
