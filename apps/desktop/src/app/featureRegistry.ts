import authFeature from "@/features/auth/feature.config";
import aiCostFeature from "@/features/ai-cost/feature.config";
import dashboardFeature from "@/features/dashboard/feature.config";
import goalsFeature from "@/features/goals/feature.config";
import libraryFeature from "@/features/library/feature.config";
import moneyFeature from "@/features/money/feature.config";
import pomodoroFeature from "@/features/pomodoro/feature.config";
import projectsFeature from "@/features/projects/feature.config";
import timelineFeature from "@/features/timeline/feature.config";

export type SidebarItem = {
  label: string;
  path: string;
  icon: string;
  exact?: boolean;
};

export type DesktopFeature = {
  key: string;
  name: string;
  sidebar?: SidebarItem[];
};

export const features: DesktopFeature[] = [
  authFeature,
  dashboardFeature,
  goalsFeature,
  projectsFeature,
  timelineFeature,
  pomodoroFeature,
  libraryFeature,
  moneyFeature,
  aiCostFeature,
];

export const sidebarItems = features.flatMap((feature) => feature.sidebar ?? []);
