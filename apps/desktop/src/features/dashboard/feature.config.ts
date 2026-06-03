import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "dashboard",
  name: "Dashboard",
  sidebar: [{ label: "Dashboard", path: "/", icon: "D", exact: true }],
};

export default feature;
