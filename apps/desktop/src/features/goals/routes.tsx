import GoalDetailPage from "./pages/GoalDetailPage";
import GoalsPage from "./pages/GoalsPage";

export const goalsRoutes = [
  { path: "goals", element: <GoalsPage /> },
  { path: "goal/:id", element: <GoalDetailPage /> },
];
