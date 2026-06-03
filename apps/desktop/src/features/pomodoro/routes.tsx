import PomodoroHistoryPage from "./pages/PomodoroHistoryPage";
import PomodoroPage from "./pages/PomodoroPage";

export const pomodoroRoutes = [
  { path: "pomodoro", element: <PomodoroPage /> },
  { path: "pomodoro/history", element: <PomodoroHistoryPage /> },
];
