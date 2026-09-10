import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

/* Round-18k: build tag visible in UI header + /api/version so the user can
 * tell a stale cached bundle from the latest deploy. */
function gitShort(): string {
  const fromEnv = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "";
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}
const BUILD_TAG = `${gitShort()} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`;

const voiceHeaders = {
  "Permissions-Policy": "microphone=(self)",
  "Feature-Policy": "microphone 'self'",
};

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_TAG__: JSON.stringify(BUILD_TAG) },
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
