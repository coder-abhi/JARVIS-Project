import type { Task } from "@/lib/api";

const statusTone = {
  todo: "border-gray-200 bg-gray-50 text-gray-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function TimelineBar({ task, onEdit }: { task: Task; onEdit?: (task: Task) => void }) {
  const deadline = task.deadline ? new Date(task.deadline) : null;
  const startDate = task.start_date ? new Date(task.start_date) : null;
  const createdAt = new Date(task.created_at);
  const displayedStart = startDate ?? createdAt;
  const daysUntilDeadline = deadline ? getDayDifference(deadline, new Date()) : null;
  const durationDays = deadline ? Math.max(getDayDifference(deadline, displayedStart), 1) : null;
  const remainingMinutes = task.status === "done" ? 0 : Math.max(Math.round((task.eta_hours - task.time_spent_hours) * 60), 0);

  return (
    <div
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onClick={() => onEdit?.(task)}
      onKeyDown={(event) => {
        if (onEdit && (event.key === "Enter" || event.key === " ")) onEdit(task);
      }}
      className={`relative grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-[140px_minmax(0,1fr)_120px] md:items-center ${
        onEdit ? "cursor-pointer transition hover:border-gray-300 hover:shadow-md" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full border border-gray-200 bg-gray-50">
          <span className="text-sm font-semibold text-gray-950">{deadline ? deadline.getDate() : "--"}</span>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {deadline ? deadline.toLocaleString(undefined, { month: "short" }) : "No date"}
          </p>
          <p className="text-sm text-gray-600">{deadline ? deadline.getFullYear() : "Flexible"}</p>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-gray-950">{task.title}</p>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone[task.status]}`}>
            {task.status.replace("_", " ")}
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-gray-100">
          <div className="absolute inset-y-0 left-0 w-2 rounded-full bg-gray-950" />
          <div className="absolute inset-y-0 right-0 w-2 rounded-full bg-gray-300" />
        </div>
        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>{startDate ? `Started ${startDate.toLocaleDateString()}` : `Created ${createdAt.toLocaleDateString()}`}</span>
          <span>{deadline ? deadline.toLocaleDateString() : "No deadline set"}</span>
        </div>
      </div>

      <div className="rounded-md bg-gray-50 p-3 text-sm">
        {task.status === "done" ? (
          <p className="font-semibold text-emerald-700">Completed</p>
        ) : daysUntilDeadline === null ? (
          <p className="font-semibold text-gray-700">{remainingMinutes} min left</p>
        ) : (
          <p className={daysUntilDeadline < 0 ? "font-semibold text-red-700" : "font-semibold text-gray-950"}>
            {daysUntilDeadline < 0 ? `${Math.abs(daysUntilDeadline)}d late` : `${daysUntilDeadline}d left`}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {durationDays ? `${durationDays} day window` : `${remainingMinutes} min remaining`}
        </p>
      </div>
    </div>
  );
}

function getDayDifference(later: Date, earlier: Date) {
  const laterDay = new Date(later);
  const earlierDay = new Date(earlier);

  laterDay.setHours(0, 0, 0, 0);
  earlierDay.setHours(0, 0, 0, 0);

  return Math.ceil((laterDay.getTime() - earlierDay.getTime()) / (1000 * 60 * 60 * 24));
}
