import LibraryPage from "./pages/LibraryPage";
import ShelfPage from "./pages/ShelfPage";

export const libraryRoutes = [
  { path: "library", element: <LibraryPage /> },
  { path: "library/shelf", element: <ShelfPage /> },
];
