import { createBrowserRouter, Navigate } from "react-router-dom";

import App from "./App";
import LoginPage from "@/features/auth/pages/LoginPage";
import SignupPage from "@/features/auth/pages/SignupPage";
import DashboardPage from "@/features/dashboard/pages/DashboardPage";
import GoalsPage from "@/features/goals/pages/GoalsPage";
import LibraryPage from "@/features/library/pages/LibraryPage";
import ShelfPage from "@/features/library/pages/ShelfPage";
import PomodoroHistoryPage from "@/features/pomodoro/pages/PomodoroHistoryPage";
import PomodoroPage from "@/features/pomodoro/pages/PomodoroPage";
import ProjectDetailPage from "@/features/projects/pages/ProjectDetailPage";
import TimelinePage from "@/features/timeline/pages/TimelinePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "project/:id", element: <ProjectDetailPage /> },
      { path: "timeline", element: <TimelinePage /> },
      { path: "pomodoro", element: <PomodoroPage /> },
      { path: "pomodoro/history", element: <PomodoroHistoryPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/shelf", element: <ShelfPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "signup", element: <SignupPage /> },
      { path: "*", element: <Navigate to="/" replace /> }
    ]
  }
]);
