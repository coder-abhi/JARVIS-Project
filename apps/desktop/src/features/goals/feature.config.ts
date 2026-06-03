import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "goals",
  name: "Goals",
  sidebar: [{ label: "Goals", path: "/goals", icon: "G" }],
};

export default feature;
