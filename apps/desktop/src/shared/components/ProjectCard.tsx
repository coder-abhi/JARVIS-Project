import Link from "next/link";
import type { ProjectSummary } from "@/lib/api";

type ProjectCardProps = {
  project: ProjectSummary;
};

const typeStyles: Record<ProjectSummary["type"], string> = {
  fixed: "bg-amber-100 text-amber-900",
  continuous: "bg-cyan-100 text-cyan-900",
};

const typeLabels: Record<ProjectSummary["type"], string> = {
  fixed: "Fixed",
  continuous: "Continuous",
};

export function ProjectCard({ project }: ProjectCardProps) {
  const totalTasks = project.total_tasks ?? 0;
  const completedTasks = project.completed_tasks ?? 0;
  const inProgressTasks = project.in_progress_tasks ?? 0;
  const overdueTasks = project.overdue_tasks ?? 0;
  const etaHours = project.eta_hours ?? 0;
  const spentHours = project.time_spent_hours ?? 0;
  const completedHours = project.completed_hours ?? 0;
  const remainingHours = project.remaining_hours ?? 0;
  const etaMinutes = Math.round(etaHours * 60);
  const spentMinutes = Math.round(spentHours * 60);
  const progressBasis = completedHours + remainingHours;
  const nextGoal = getNextContinuousGoal(spentMinutes);
  const progress =
    project.type === "continuous"
      ? getContinuousSprintProgress(spentMinutes, nextGoal)
      : progressBasis === 0
        ? 0
        : Math.min(Math.round((completedHours / progressBasis) * 100), 100);
  const deadline = formatDeadline(project.next_deadline);
  const statusTone = overdueTasks > 0 ? "text-red-700" : "text-emerald-700";

  return (
    <Link
      href={`/project/${project.id}`}
      className="group block rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-xl hover:shadow-stone-900/10"
    >
      <div className="flex min-h-24 flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${typeStyles[project.type]}`}>
              {typeLabels[project.type]}
            </span>
            <h3 className="mt-3 line-clamp-2 text-xl font-semibold leading-snug text-stone-950">{project.name}</h3>
          </div>
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-stone-950 text-sm font-semibold text-white">
            {progress}%
          </div>
        </div>

        <div>
          <div className="h-2 rounded-full bg-stone-100">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-teal-500 via-emerald-500 to-lime-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Tasks" value={totalTasks} />
            <Metric label="Done" value={completedTasks} />
            <Metric label="Active" value={inProgressTasks} />
          </div>
        </div>

        <div className="grid gap-3 border-t border-stone-100 pt-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-stone-500">Deadline</p>
            <p className={`mt-1 font-semibold ${statusTone}`}>{deadline}</p>
          </div>
          <div>
            <p className="text-stone-500">{project.type === "continuous" ? "Invested Time" : "Planned / Invested"}</p>
            <p className="mt-1 font-semibold text-stone-950">
              {project.type === "continuous" ? `${spentMinutes} min` : `${etaMinutes} min / ${spentMinutes} min`}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className={overdueTasks > 0 ? "font-semibold text-red-700" : "text-stone-500"}>
            {overdueTasks > 0 ? `${overdueTasks} overdue` : "On track"}
          </span>
          <span className="font-medium text-stone-950 transition group-hover:translate-x-1">Open</span>
        </div>
      </div>
    </Link>
  );
}

function getNextContinuousGoal(spentMinutes: number) {
  return (Math.floor(Math.max(spentMinutes, 0) / 6000) + 1) * 6000;
}

function getContinuousSprintProgress(spentMinutes: number, nextGoal: number) {
  const sprintStart = nextGoal - 6000;
  const sprintMinutes = Math.max(spentMinutes - sprintStart, 0);

  return Math.min(Math.round(sprintMinutes / 60), 100);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-stone-50 px-3 py-2">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function formatDeadline(value?: string | null) {
  if (!value) return "No active deadline";

  const deadline = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadlineDay = new Date(deadline);
  deadlineDay.setHours(0, 0, 0, 0);
  const days = Math.round((deadlineDay.getTime() - today.getTime()) / 86_400_000);
  const formatted = deadline.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  if (days < 0) return `${formatted}, overdue`;
  if (days === 0) return `${formatted}, today`;
  if (days === 1) return `${formatted}, tomorrow`;
  return `${formatted}, ${days} days`;
}
