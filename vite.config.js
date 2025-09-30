// vite.config.ts (root)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Your repo slug:
export default defineConfig({
  plugins: [react()],
  base: "/Test-Mocap-Webapp/",
  build: { outDir: "dist" }
});
