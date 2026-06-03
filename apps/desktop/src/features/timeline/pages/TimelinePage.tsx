"use client";

import Link from "next/link";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { TaskEditor } from "@/components/TaskEditor";
import { getProjectTasks, getProjects, updateTask, type Project, type Task, type TaskStatus, type TaskUpdate } from "@/lib/api";

type TimelineView = "3day" | "week" | "month";

type TimelineTask = {
  id: string;
  raw: Task;
  title: string;
  projectName: string;
  status: TaskStatus;
  etaHours: number;
  timeSpentHours: number;
  startDate: Date | null;
  createdAt: Date;
  deadline: Date | null;
  color: "blue" | "purple" | "pink" | "yellow" | "teal";
};

type ProjectWithTasks = {
  project: Project;
  tasks: Task[];
};

const dayMs = 86_400_000;
const colors: TimelineTask["color"][] = ["blue", "purple", "pink", "yellow", "teal"];

const viewOptions: Record<TimelineView, { label: string; days: number; columnWidth: number }> = {
  "3day": { label: "3 day", days: 3, columnWidth: 176 },
  week: { label: "Week", days: 7, columnWidth: 112 },
  month: { label: "Month", days: 30, columnWidth: 44 },
};

const colorClasses = {
  blue: {
    track: "bg-blue-100",
    fill: "bg-blue-500",
    text: "text-blue-700",
    dot: "bg-blue-500",
    handle: "border-blue-600 bg-blue-600",
  },
  purple: {
    track: "bg-purple-100",
    fill: "bg-purple-500",
    text: "text-purple-700",
    dot: "bg-purple-500",
    handle: "border-purple-600 bg-purple-600",
  },
  pink: {
    track: "bg-pink-100",
    fill: "bg-pink-500",
    text: "text-pink-700",
    dot: "bg-pink-500",
    handle: "border-pink-600 bg-pink-600",
  },
  yellow: {
    track: "bg-yellow-100",
    fill: "bg-yellow-400",
    text: "text-yellow-700",
    dot: "bg-yellow-400",
    handle: "border-yellow-500 bg-yellow-500",
  },
  teal: {
    track: "bg-teal-100",
    fill: "bg-teal-500",
    text: "text-teal-700",
    dot: "bg-teal-500",
    handle: "border-teal-600 bg-teal-600",
  },
};

const statusLabels: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};

export default function TimelinePage() {
  const [items, setItems] = useState<ProjectWithTasks[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TimelineView>("week");
  const [activeTodayOnly, setActiveTodayOnly] = useState(false);
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
      items.flatMap((item, projectIndex) =>
        item.tasks.map((task, taskIndex) => toTimelineTask(task, item.project.name, projectIndex + taskIndex)),
      ),
    [items],
  );

  const visibleTasks = useMemo(
    () => (activeTodayOnly ? timelineTasks.filter((task) => isTaskActiveOn(task, today)) : timelineTasks),
    [activeTodayOnly, timelineTasks, today],
  );
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
  const weeklyOperationDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index)), [today]);
  const timeAllocation = buildTimeAllocation(timelineTasks);

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

  return (
    <main className="ops-screen">
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

      {error ? <p className="ops-alert danger">{error}</p> : null}

      <section className="ops-panel">
        <div className="ops-panel-head">
          <h2>Weekly Operations Grid</h2>
          <span>{visibleTasks.length} scheduled objectives</span>
        </div>
        <div className="weekly-ops-grid">
          {weeklyOperationDates.map((date) => {
            const dayTasks = timelineTasks.filter((task) => isTaskActiveOn(task, date)).slice(0, 4);
            return (
              <div key={date.toISOString()} className="weekly-day">
                <div>
                  <strong>{date.toLocaleDateString(undefined, { weekday: "short" })}</strong>
                  <span>{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
                {dayTasks.length ? (
                  dayTasks.map((task) => (
                    <button key={task.id} type="button" onClick={() => onTimelineTaskEdit(task)} className={`weekly-task ${task.status}`}>
                      <span>{task.title}</span>
                      <b>{Math.round(task.etaHours * 60)}m</b>
                    </button>
                  ))
                ) : (
                  <p className="ops-empty compact">No blocks</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-4 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="ops-panel overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">{viewOptions[view].label} Operations Plan</h2>
              <p className="mt-1 text-sm text-gray-500">{visibleTasks.length} visible tasks across {items.length} projects</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <div className="flex rounded-full border border-gray-200 bg-gray-50 p-0.5">
                {(Object.keys(viewOptions) as TimelineView[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setView(option)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                      view === option ? "bg-gray-950 text-white shadow-sm" : "text-gray-500 hover:text-gray-950"
                    }`}
                  >
                    {viewOptions[option].label}
                  </button>
                ))}
              </div>
              <label className="flex h-7 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-semibold text-gray-600">
                <input
                  type="checkbox"
                  checked={activeTodayOnly}
                  onChange={(event) => setActiveTodayOnly(event.target.checked)}
                  className="h-3.5 w-3.5 accent-gray-950"
                />
                Active
              </label>
              <button
                type="button"
                onClick={recalibrateToToday}
                className="h-6 rounded-full border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Today
              </button>
            </div>
          </div>

          {isLoading ? <p className="p-6 text-sm text-gray-500">Loading timeline...</p> : null}

          {!isLoading && timelineTasks.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-semibold text-gray-950">No tasks yet</p>
              <p className="mt-2 text-sm text-gray-500">Create tasks inside a project and they will appear here automatically.</p>
            </div>
          ) : null}

          {!isLoading && timelineTasks.length > 0 && visibleTasks.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-semibold text-gray-950">No active tasks today</p>
              <p className="mt-2 text-sm text-gray-500">Turn off the filter to see the full timeline.</p>
            </div>
          ) : null}

          {!isLoading && visibleTasks.length > 0 ? (
            <div ref={scrollerRef} className="overflow-x-auto">
              <div className="min-w-full" style={{ width: 260 + timelineWidth }}>
                <div className="grid grid-cols-[260px_1fr] border-b border-gray-100 bg-gray-50/80">
                  <div className="px-5 py-4 text-sm font-semibold text-gray-500">Tasks</div>
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
                    <div className="grid grid-cols-[260px_1fr] bg-gray-50/60">
                      <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{projectName}</div>
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
            <div className="mt-5 space-y-3">
              <SummaryMetric label="Planned Hours" value={`${(totalPlannedMinutes / 60).toFixed(1)}h`} />
              <SummaryMetric label="Actual Hours" value={`${(totalSpentMinutes / 60).toFixed(1)}h`} />
              <SummaryMetric label="Completion Rate" value={`${completionRate}%`} tone="success" />
            </div>
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Time Allocation</h2>
              <span>mission categories</span>
            </div>
            <div className="allocation-list">
              {timeAllocation.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <b>{item.minutes}m</b>
                  <div className="ops-progress"><span style={{ width: `${item.percent}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-3">
        {(["todo", "in_progress", "done"] as TaskStatus[]).map((status) => (
          <StatusCard key={status} status={status} tasks={timelineTasks.filter((task) => task.status === status)} onEdit={setEditingTaskFromTimeline} />
        ))}
      </section>

      <TaskEditor task={editingTask} onClose={() => setEditingTask(null)} onSave={handleTaskSave} />
    </main>
  );

  function setEditingTaskFromTimeline(task: TimelineTask) {
    const fullTask = items.flatMap((item) => item.tasks).find((item) => item.id === task.id);
    if (fullTask) setEditingTask(fullTask);
  }

  function onTimelineTaskEdit(task: TimelineTask) {
    setEditingTaskFromTimeline(task);
  }
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
      <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-red-500" style={{ left: currentTimeOffset }}>
        {currentTimeLabel ? (
          <span className="absolute left-1/2 top-1 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            {currentTimeLabel}
          </span>
        ) : null}
      </div>
      <div className="flex">
        {dates.map((date) => (
          <div
            key={date.toISOString()}
            className={`border-l border-gray-100 text-center ${compact ? "h-full" : "px-2 py-3"}`}
            style={{ width: columnWidth }}
          >
            {!compact ? (
              <>
                <p className="text-xs font-semibold uppercase text-gray-400">
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-700">
                  {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
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
  const colors = colorClasses[task.color];
  const percentageTextColor = progress > 45 ? "text-white" : colors.text;
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
      className="grid cursor-pointer grid-cols-[260px_1fr] border-t border-gray-100 transition hover:bg-gray-50/70"
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors.dot}`} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-950">{task.title}</p>
          <p className="mt-1 text-xs text-gray-500">
            {Math.round(task.timeSpentHours * 60)} min invested / {Math.round(task.etaHours * 60)} min ETA
          </p>
        </div>
      </div>
      <div className="relative min-h-16" style={{ width: timelineWidth }}>
        <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-red-500" style={{ left: currentTimeOffset }} />
        <div className="absolute inset-0 flex">
          {dates.map((date) => (
            <div key={date.toISOString()} className="h-full border-l border-gray-100" style={{ width: columnWidth }} />
          ))}
        </div>
        {!visibleRangeEnded ? (
          <div
            className={`absolute top-1/2 h-9 -translate-y-1/2 overflow-hidden rounded-full ${colors.track} shadow-sm`}
            style={{ left, width }}
          >
            <div className={`absolute inset-y-0 left-0 rounded-full ${colors.fill}`} style={{ width: `${progress}%` }} />
            <div className={`absolute inset-0 flex items-center justify-center px-3 text-xs font-bold ${percentageTextColor}`}>
              {progress}%
            </div>
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
              className={`absolute right-0 top-0 h-full w-4 cursor-ew-resize border-l-2 ${colors.handle}`}
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
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "success";
}) {
  const valueColor = tone === "danger" ? "text-red-600" : tone === "success" ? "text-teal-600" : "text-gray-950";

  return (
    <div className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-4 py-3">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function StatusCard({ onEdit, status, tasks }: { onEdit: (task: TimelineTask) => void; status: TaskStatus; tasks: TimelineTask[] }) {
  const accentByStatus: Record<TaskStatus, string> = {
    todo: "border-blue-100 bg-blue-50/60 text-blue-700",
    in_progress: "border-purple-100 bg-purple-50/60 text-purple-700",
    done: "border-teal-100 bg-teal-50/60 text-teal-700",
  };

  return (
    <div className="ops-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-950">Queue Status / {statusLabels[status]}</h3>
        <span className={`rounded border px-3 py-1 text-sm font-semibold ${accentByStatus[status]}`}>{tasks.length}</span>
      </div>
      <div className="mt-4 space-y-3">
        {tasks.length === 0 ? <p className="text-sm text-gray-400">No tasks</p> : null}
        {tasks.slice(0, 3).map((task) => {
          const colors = colorClasses[task.color];

          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onEdit(task)}
              className="block w-full rounded border border-gray-200 bg-gray-50 p-3 text-left transition hover:bg-gray-100"
            >
              <p className="text-sm font-semibold text-gray-950">{task.title}</p>
              <p className={`mt-1 text-xs font-medium ${colors.text}`}>{task.projectName}</p>
            </button>
          );
        })}
      </div>
    </div>
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

function toTimelineTask(task: Task, projectName: string, colorIndex: number): TimelineTask {
  return {
    id: task.id,
    raw: task,
    title: task.title,
    projectName,
    status: task.status,
    etaHours: task.eta_hours,
    timeSpentHours: task.time_spent_hours,
    startDate: task.start_date ? new Date(task.start_date) : null,
    createdAt: new Date(task.created_at),
    deadline: task.deadline ? new Date(task.deadline) : null,
    color: colors[colorIndex % colors.length],
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
