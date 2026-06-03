import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "timeline",
  name: "Timeline",
  sidebar: [{ label: "Timeline", path: "/timeline", icon: "T" }],
};

export default feature;
