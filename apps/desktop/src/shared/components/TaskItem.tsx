import type { Task, TaskPriority, TaskStatus } from "@/lib/api";

const statusStyles: Record<TaskStatus, string> = {
  todo: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
};

const priorityStyles: Record<TaskPriority, string> = {
  high: "bg-red-50 text-red-700 ring-red-100",
  medium: "bg-amber-50 text-amber-700 ring-amber-100",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

const progressTones = [
  { limit: 35, text: "text-red-700", track: "#fee2e2", fill: "#dc2626" },
  { limit: 70, text: "text-amber-700", track: "#fef3c7", fill: "#d97706" },
  { limit: 99, text: "text-blue-700", track: "#dbeafe", fill: "#2563eb" },
  { limit: 100, text: "text-emerald-700", track: "#d1fae5", fill: "#059669" },
];

type TaskItemProps = {
  task: Task;
  onEdit: (task: Task) => void;
  onStatusChange: (taskId: string, nextStatus: TaskStatus) => void;
  onToggleComplete: (task: Task) => void;
};

export function TaskItem({ task, onEdit, onStatusChange, onToggleComplete }: TaskItemProps) {
  const deadline = task.deadline ? new Date(task.deadline).toLocaleDateString() : "No deadline";
  const startDate = task.start_date ? new Date(task.start_date).toLocaleDateString() : "No start date";
  const etaMinutes = Math.round(task.eta_hours * 60);
  const spentMinutes = Math.round(task.time_spent_hours * 60);
  const overrunMinutes = spentMinutes - etaMinutes;
  const progress = getTaskProgress(task);
  const progressTone = progressTones.find((tone) => progress <= tone.limit) ?? progressTones[progressTones.length - 1];
  const remainingMinutes = task.status === "done" ? 0 : Math.max(etaMinutes - spentMinutes, 0);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onEdit(task);
      }}
      className="grid cursor-pointer gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-gray-300 hover:shadow-md md:grid-cols-[60px_minmax(0,1.5fr)_0.75fr_0.75fr] md:items-center"
    >
      <div className="flex items-center gap-2 md:block">
        <div
          className="grid size-12 place-items-center rounded-full"
          style={{ background: `conic-gradient(${progressTone.fill} ${progress * 3.6}deg, ${progressTone.track} 0deg)` }}
          aria-label={`${progress}% complete`}
        >
          <div className="grid size-9 place-items-center rounded-full bg-white">
            <span className={`text-xs font-bold ${progressTone.text}`}>{progress}%</span>
          </div>
        </div>
        <p className={`text-[11px] font-semibold md:mt-1.5 md:text-center ${progressTone.text}`}>Complete</p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-gray-950">{task.title}</p>
          <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[task.status]}`}>
            {task.status.replace("_", " ")}
          </span>
          <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${priorityStyles[task.priority]}`}>
            {task.priority}
          </span>
        </div>
        {task.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{task.description}</p> : null}
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          <span>Deadline: {deadline}</span>
          <span>Start: {task.status === "todo" ? "Not started" : startDate}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-md bg-gray-50 p-2.5 text-sm md:grid-cols-1">
        <p className="text-gray-600">
          <span className="block text-xs uppercase tracking-wide text-gray-400">ETA</span>
          <span className="text-sm font-semibold text-gray-950">{etaMinutes} min</span>
        </p>
        <p className="text-gray-600">
          <span className="block text-xs uppercase tracking-wide text-gray-400">Spent</span>
          <span className="text-sm font-semibold text-gray-950">{spentMinutes} min</span>
        </p>
        <p className="text-gray-600">
          <span className="block text-xs uppercase tracking-wide text-gray-400">Left</span>
          <span className={overrunMinutes > 0 ? "text-sm font-semibold text-red-600" : "text-sm font-semibold text-gray-950"}>
            {remainingMinutes} min
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleComplete(task);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className={
            task.status === "done"
              ? "rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              : "rounded-md bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-800"
          }
        >
          {task.status === "done" ? "Mark incomplete" : "Mark complete"}
        </button>
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)}
          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs outline-none ring-gray-900/10 focus:ring-4"
        >
          <option value="todo">Todo</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </div>
    </div>
  );
}

function getTaskProgress(task: Task) {
  if (task.status === "done") return 100;
  if (task.eta_hours <= 0) return task.time_spent_hours > 0 ? 100 : 0;
  return Math.min(Math.round((task.time_spent_hours / task.eta_hours) * 100), 100);
}
