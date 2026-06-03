import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "library",
  name: "Library",
  sidebar: [{ label: "Library", path: "/library", icon: "L" }],
};

export default feature;
