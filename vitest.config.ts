import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  /* Tests me bhi wahi build-time constant jo Vite prod build me deta hai (warna App render par
   * "__BUILD_TAG__ is not defined" aata hai — sirf test harness ki baat, prod code same). */
  define: { __BUILD_TAG__: JSON.stringify("0006eb4 · 2026-10-01 00:00Z") },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
