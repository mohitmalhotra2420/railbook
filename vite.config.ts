import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const voiceHeaders = {
  "Permissions-Policy": "microphone=(self)",
  "Feature-Policy": "microphone 'self'",
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    headers: voiceHeaders,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    headers: voiceHeaders,
  },
});
