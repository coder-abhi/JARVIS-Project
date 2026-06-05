import { clearAuthSession, getAuthToken, type AuthSession, type AuthUser } from "@/lib/auth";

export type ProjectType = "continuous" | "fixed";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "high" | "medium" | "low";
export type BookStatus = "yet_to_start" | "reading" | "read";
export type GoalCategory = "monthly" | "quarterly" | "yearly" | "five_year";

export type LinkedGoal = {
  id: string;
  category: GoalCategory;
  title: string;
};

export type LinkedProject = {
  id: string;
  name: string;
  type: ProjectType;
};

export type Project = {
  id: string;
  name: string;
  type: ProjectType;
  created_at: string;
  linked_goals: LinkedGoal[];
};

export type ProjectSummary = Project & {
  total_tasks: number;
  completed_tasks: number;
  in_progress_tasks: number;
  overdue_tasks: number;
  eta_hours: number;
  time_spent_hours: number;
  completed_hours: number;
  remaining_hours: number;
  next_deadline?: string | null;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  importance_rating: number;
  eta_hours: number;
  time_spent_hours: number;
  start_date?: string | null;
  deadline?: string | null;
  created_at: string;
};

export type ProjectInput = Pick<Project, "name" | "type"> & {
  linked_goal_ids?: string[];
};
export type TaskInput = Omit<Task, "id" | "created_at" | "importance_rating"> & {
  importance_rating?: number;
};
export type TaskUpdate = Partial<Omit<Task, "id" | "project_id" | "created_at">>;

export type Goal = {
  id: string;
  category: GoalCategory;
  title: string;
  target_value?: number | null;
  current_value: number;
  unit?: string | null;
  created_at: string;
  measurable: boolean;
  progress_percentage?: number | null;
  linked_projects: LinkedProject[];
};

export type GoalInput = Omit<Goal, "id" | "created_at" | "measurable" | "progress_percentage" | "linked_projects"> & {
  linked_project_ids?: string[];
};
export type GoalUpdate = Partial<Pick<Goal, "title" | "target_value" | "current_value" | "unit">> & {
  linked_project_ids?: string[];
};

export type GoalTask = {
  id: string;
  project_id: string;
  project_name: string;
  linked_goals: LinkedGoal[];
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  importance_rating: number;
  eta_hours: number;
  time_required_minutes: number;
  created_at: string;
};

export type CompletedGoalLog = {
  id: string;
  goal_id?: string | null;
  task_id?: string | null;
  title: string;
  goal_label: string;
  created_at: string;
};

export type PersonalityInsight = {
  text?: string | null;
  refreshed_at?: string | null;
};

export type GoalNextAction = {
  title: string;
  related_goal: string;
  importance: number;
  urgency: number;
};

export type GoalsOverview = {
  goals: Goal[];
  active_tasks: GoalTask[];
  recent_completed_tasks: CompletedGoalLog[];
  personality_insight: PersonalityInsight;
};

export type GoalLogResponse = {
  mode: "created_task" | "completed_task" | string;
  corrected_text: string;
  related_goal: string;
  task?: GoalTask | null;
  completion?: CompletedGoalLog | null;
};

export type PomodoroAssignment = {
  assigned: boolean;
  confidence: number;
  project_id?: string | null;
  task_id?: string | null;
  reason?: string | null;
};

export type PomodoroProjectSession = {
  id: string;
  project_id: string;
  mode: string;
  minutes: number;
  description?: string | null;
  started_at: string;
  completed_at: string;
  created_at: string;
};

export type PomodoroProjectSessionInput = Omit<PomodoroProjectSession, "created_at">;

export type BookChapter = {
  id: string;
  book_id: string;
  title: string;
  position: number;
  resonated: boolean;
};

export type Book = {
  id: string;
  title: string;
  author?: string | null;
  category: string;
  total_pages: number;
  current_page: number;
  status: BookStatus;
  liked: boolean;
  rating?: number | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  created_at: string;
  pages_read: number;
  pages_remaining: number;
  chapters: BookChapter[];
};

export type BookInput = Omit<Book, "id" | "created_at" | "chapters" | "current_page" | "pages_read" | "pages_remaining">;
export type BookUpdate = Partial<BookInput>;

export type ReadingLogInput = {
  book_id: string;
  pages_read?: number;
  start_page?: number;
  end_page?: number;
  read_at?: string | null;
  note?: string | null;
};

export type LibrarySummary = {
  total_books: number;
  read_books: number;
  liked_books: number;
  yet_to_start_books: number;
  reading_books: number;
  pages_today: number;
  pages_this_week: number;
  first_reading_date?: string | null;
  current_categories: string[];
  daywise_pages: { date: string; pages: number }[];
  daily_pages?: { date: string; pages: number }[];
  monthly_pages: { month: string; pages: number }[];
  categories: { category: string; books: number }[];
};

export type SuggestedBook = {
  title: string;
  author?: string | null;
  category: string;
  reason: string;
};

export type OwnedBookRecommendation = {
  book_id: string;
  title: string;
  author?: string | null;
  category: string;
  status: BookStatus;
  reason: string;
};

export type AiStatus = {
  connected: boolean;
  model: string;
  message: string;
};

export type AiFeatureSetting = {
  feature: string;
  label: string;
  description: string;
  enabled: boolean;
};

export type AiFeatureCost = {
  feature: string;
  label: string;
  cost_cents: number;
  share_percentage: number;
  requests: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  average_cost_cents: number;
};

export type AiDailyCost = {
  date: string;
  cost_cents: number;
  requests: number;
  total_tokens: number;
};

export type AiRecentRequest = {
  id: string;
  feature: string;
  label: string;
  model: string;
  cost_cents: number;
  total_tokens: number;
  status: string;
  latency_ms: number;
  pricing_available: boolean;
  created_at: string;
};

export type AiCostSummary = {
  period_days?: number | null;
  period_start?: string | null;
  total_cost_cents: number;
  today_cost_cents: number;
  month_cost_cents: number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  unpriced_requests: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  average_cost_cents: number;
  by_feature: AiFeatureCost[];
  daily: AiDailyCost[];
  recent_requests: AiRecentRequest[];
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      clearAuthSession();
      if (!["/login", "/signup"].includes(window.location.pathname)) {
        window.location.href = "/login";
      }
    }
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export function login(username: string, password: string) {
  return request<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function signup(username: string, password: string) {
  return request<AuthSession>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getCurrentUser() {
  return request<AuthUser>("/auth/me");
}

export function getProjects() {
  return request<Project[]>("/projects");
}

export function getProjectSummaries() {
  return request<ProjectSummary[]>("/projects/summary");
}

export function createProject(project: ProjectInput) {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(project),
  });
}

export function getProjectTasks(projectId: string) {
  return request<Task[]>(`/projects/${projectId}/tasks`);
}

export function createTask(task: TaskInput) {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateTask(taskId: string, task: TaskUpdate) {
  return request<Task>(`/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify(task),
  });
}

export function matchPomodoroAssignment(note: string, projectIds: string[] = []) {
  return request<PomodoroAssignment>("/tasks/pomodoro-assignment", {
    method: "POST",
    body: JSON.stringify({ note, project_ids: projectIds }),
  });
}

export function getProjectPomodoroSessions(projectId: string) {
  return request<PomodoroProjectSession[]>(`/projects/${projectId}/pomodoro-sessions`);
}

export function saveProjectPomodoroSession(session: PomodoroProjectSessionInput) {
  return request<PomodoroProjectSession>(`/projects/pomodoro-sessions/${session.id}`, {
    method: "PUT",
    body: JSON.stringify(session),
  });
}

export function deleteProjectPomodoroSession(sessionId: string) {
  return request<void>(`/projects/pomodoro-sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function getAiStatus() {
  return request<AiStatus>("/ai/status");
}

export function getAiCosts(days = 30) {
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  return request<AiCostSummary>(`/ai/costs?days=${days}&timezone_offset_minutes=${timezoneOffsetMinutes}`);
}

export function getAiFeatureSettings() {
  return request<AiFeatureSetting[]>("/ai/features");
}

export function updateAiFeatureSetting(feature: string, enabled: boolean) {
  return request<AiFeatureSetting>(`/ai/features/${encodeURIComponent(feature)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function getGoalsOverview() {
  return request<GoalsOverview>("/goals/overview");
}

export function createGoal(goal: GoalInput) {
  return request<Goal>("/goals", {
    method: "POST",
    body: JSON.stringify(goal),
  });
}

export function updateGoal(goalId: string, goal: GoalUpdate) {
  return request<Goal>(`/goals/${goalId}`, {
    method: "PUT",
    body: JSON.stringify(goal),
  });
}

export function logGoalEntry(text: string) {
  return request<GoalLogResponse>("/goals/log", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function completeGoalTask(taskId: string) {
  return request<CompletedGoalLog>(`/goals/tasks/${taskId}/complete`, {
    method: "PUT",
  });
}

export function restoreCompletedGoal(completionId: string) {
  return request<GoalTask>(`/goals/completions/${completionId}/restore`, {
    method: "PUT",
  });
}

export function refreshPersonalityInsight() {
  return request<PersonalityInsight>("/goals/personality/refresh", {
    method: "POST",
  });
}

export function getGoalNextActions(refresh = false) {
  return request<GoalNextAction[]>(`/goals/next-actions?refresh=${refresh}`);
}

export function getLibrarySummary() {
  return request<LibrarySummary>("/library/summary");
}

export function getBooks() {
  return request<Book[]>("/library/books");
}

export function createBook(book: BookInput) {
  return request<Book>("/library/books", {
    method: "POST",
    body: JSON.stringify(book),
  });
}

export function updateBook(bookId: string, book: BookUpdate) {
  return request<Book>(`/library/books/${bookId}`, {
    method: "PUT",
    body: JSON.stringify(book),
  });
}

export function updateChapter(chapterId: string, resonated: boolean) {
  return request<BookChapter>(`/library/chapters/${chapterId}`, {
    method: "PUT",
    body: JSON.stringify({ resonated }),
  });
}

export function addChapter(bookId: string, title: string) {
  return request<BookChapter>(`/library/books/${bookId}/chapters`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function regenerateChapters(bookId: string) {
  return request<{ status: string }>(`/library/books/${bookId}/chapters/regenerate`, {
    method: "POST",
  });
}

export function deleteChapter(chapterId: string) {
  return request<void>(`/library/chapters/${chapterId}`, {
    method: "DELETE",
  });
}

export function deleteBookChapters(bookId: string) {
  return request<void>(`/library/books/${bookId}/chapters`, {
    method: "DELETE",
  });
}

export function createReadingLog(readingLog: ReadingLogInput) {
  return request<{ id: string } & ReadingLogInput>("/library/reading-logs", {
    method: "POST",
    body: JSON.stringify(readingLog),
  });
}

export function getLibraryRecommendations() {
  return request<SuggestedBook[]>("/library/recommendations");
}

export function getNextReadingBooks() {
  return request<OwnedBookRecommendation[]>("/library/next-reading");
}
