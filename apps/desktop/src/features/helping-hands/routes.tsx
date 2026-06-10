import HelpingHandsPage from "./pages/HelpingHandsPage";
import HelpingHandsTransactionsPage from "./pages/HelpingHandsTransactionsPage";

export const helpingHandsRoutes = [
  { path: "helping-hands", element: <HelpingHandsPage /> },
  { path: "helping-hands/transactions", element: <HelpingHandsTransactionsPage /> },
];
