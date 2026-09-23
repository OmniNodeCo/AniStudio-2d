import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    hmr: { overlay: false },
  },
  preview: { host: "0.0.0.0", port: 5173, allowedHosts: true },
  build: { target: "es2022", sourcemap: false },
});
