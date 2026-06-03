import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "goals",
  name: "Mission Control",
  sidebar: [{ label: "Mission Control", path: "/goals", icon: "MC" }],
};

export default feature;
