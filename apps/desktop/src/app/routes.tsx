import { createBrowserRouter, Navigate } from "react-router-dom";

import App from "./App";
import AiCostPage from "@/features/ai-cost/pages/AiCostPage";
import LoginPage from "@/features/auth/pages/LoginPage";
import SignupPage from "@/features/auth/pages/SignupPage";
import DashboardPage from "@/features/dashboard/pages/DashboardPage";
import GoalDetailPage from "@/features/goals/pages/GoalDetailPage";
import GoalsPage from "@/features/goals/pages/GoalsPage";
import LibraryPage from "@/features/library/pages/LibraryPage";
import MoneyPage from "@/features/money/pages/MoneyPage";
import ShelfPage from "@/features/library/pages/ShelfPage";
import PomodoroHistoryPage from "@/features/pomodoro/pages/PomodoroHistoryPage";
import PomodoroPage from "@/features/pomodoro/pages/PomodoroPage";
import ProjectDetailPage from "@/features/projects/pages/ProjectDetailPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "goal/:id", element: <GoalDetailPage /> },
      { path: "project/:id", element: <ProjectDetailPage /> },
      { path: "timeline", element: <Navigate to="/goals#schedule" replace /> },
      { path: "pomodoro", element: <PomodoroPage /> },
      { path: "pomodoro/history", element: <PomodoroHistoryPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/shelf", element: <ShelfPage /> },
      { path: "money", element: <MoneyPage /> },
      { path: "ai-cost", element: <AiCostPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "signup", element: <SignupPage /> },
      { path: "*", element: <Navigate to="/" replace /> }
    ]
  }
]);
