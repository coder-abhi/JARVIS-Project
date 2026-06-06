"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Task, TaskPriority, TaskStatus, TaskUpdate } from "@/lib/api";
import { DateTimePicker } from "@/components/DateTimePicker";

type TaskEditorProps = {
  task: Task | null;
  onClose: () => void;
  onSave: (taskId: string, changes: TaskUpdate) => Promise<void>;
};

export function TaskEditor({ task, onClose, onSave }: TaskEditorProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [eta, setEta] = useState("0");
  const [spent, setSpent] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!task) return;

    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setEta(String(Math.round(task.eta_hours * 60)));
    setSpent(String(Math.round(task.time_spent_hours * 60)));
    setStartDate(toDateInputValue(task.start_date));
    setDeadline(toDateInputValue(task.deadline));
    setError(null);
    setIsSaving(false);
  }, [task]);

  if (!task) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || !title.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      await onSave(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        eta_hours: minutesInputToHours(eta),
        time_spent_hours: minutesInputToHours(spent),
        start_date: status === "todo" ? null : startDate ? new Date(startDate).toISOString() : null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update task");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-gray-950/35 px-4 py-6">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Edit task</p>
            <h2 className="mt-1 text-lg font-semibold text-gray-950">{task.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4 p-5">
          {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="resize-none rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
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

            <DateTimePicker
              label="Start date"
              mode="date"
              value={startDate}
              disabled={status === "todo"}
              onChange={setStartDate}
            />

            <DateTimePicker label="Deadline" mode="date" value={deadline} onChange={setDeadline} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">ETA (min)</span>
              <input
                type="number"
                min="0"
                step="5"
                value={eta}
                onChange={(event) => setEta(event.target.value)}
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Spent (min)</span>
              <input
                type="number"
                min="0"
                step="5"
                value={spent}
                onChange={(event) => setSpent(event.target.value)}
                className="rounded-md border border-gray-200 px-3 py-3 outline-none ring-gray-900/10 focus:ring-4"
              />
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function toDateInputValue(value?: string | null) {
  if (!value) return "";

  return new Date(value).toISOString().slice(0, 10);
}

function minutesInputToHours(value: string) {
  return Math.round(((Number(value) || 0) / 60) * 100) / 100;
}
