import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("echarts")) return "charts";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("react")) return "react";
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
