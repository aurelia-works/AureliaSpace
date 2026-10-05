import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and doesn't need Vite's screen clearing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari16",
    chunkSizeWarningLimit: 2000,
    // The HUD window is a second, lightweight entry (no terminals, no bootstrap).
    rollupOptions: { input: { main: "index.html", hud: "hud.html" } },
  },
});
