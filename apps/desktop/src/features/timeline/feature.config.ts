import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "timeline",
  name: "Mission Schedule",
  sidebar: [{ label: "Mission Schedule", path: "/timeline", icon: "MS" }],
};

export default feature;
