import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "pomodoro",
  name: "Pomodoro",
  sidebar: [{ label: "Pomodoro", path: "/pomodoro", icon: "P" }],
};

export default feature;
