import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../client/src"),
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
  },
});
