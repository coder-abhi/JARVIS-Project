export type AppTheme = "dark-green" | "dense-terminal" | "friendly-saas";

export type ThemeMeta = {
  id: AppTheme;
  label: string;
  description: string;
};

export const themes: ThemeMeta[] = [
  {
    id: "dark-green",
    label: "Dark Green",
    description: "The original black-and-green ops console. No changes.",
  },
  {
    id: "dense-terminal",
    label: "Terminal",
    description: "Bloomberg-style monospace terminal — black, dense, bracketed hotkeys.",
  },
  {
    id: "friendly-saas",
    label: "Daylight",
    description: "Friendly modern SaaS look — light, rounded, soft shadows.",
  },
];

const themeStorageKey = "personal-project-manager:app-theme";
export const themeChangedEvent = "personal-project-manager:theme-changed";
const defaultTheme: AppTheme = "dark-green";

function isAppTheme(value: string | null): value is AppTheme {
  return value === "dark-green" || value === "dense-terminal" || value === "friendly-saas";
}

export function readTheme(): AppTheme {
  if (typeof window === "undefined") return defaultTheme;

  const stored = window.localStorage.getItem(themeStorageKey);
  return isAppTheme(stored) ? stored : defaultTheme;
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function saveTheme(theme: AppTheme) {
  window.localStorage.setItem(themeStorageKey, theme);
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(themeChangedEvent, { detail: theme }));
}

export function initializeTheme() {
  applyTheme(readTheme());
}
