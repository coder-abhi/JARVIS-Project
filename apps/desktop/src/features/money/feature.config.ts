import type { DesktopFeature } from "@/app/featureRegistry";

const feature: DesktopFeature = {
  key: "money",
  name: "Wealth Command",
  sidebar: [{ label: "Wealth Command", path: "/money", icon: "WC" }],
};

export default feature;
