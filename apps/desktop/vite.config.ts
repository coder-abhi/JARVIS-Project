import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "next/link", replacement: path.resolve(__dirname, "src/shared/next/Link.tsx") },
      { find: "next/navigation", replacement: path.resolve(__dirname, "src/shared/next/navigation.ts") },
      { find: "@/lib", replacement: path.resolve(__dirname, "src/shared/lib") },
      { find: "@/components", replacement: path.resolve(__dirname, "src/shared/components") },
      { find: "@", replacement: path.resolve(__dirname, "src") }
    ]
  },
  server: {
    port: 1420,
    strictPort: true
  }
});
