import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "dashboard",
  name: "Command Overview",
  sidebar: [{ label: "Command Overview", path: "/", icon: "CO", exact: true }],
};

export default feature;
