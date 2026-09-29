import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@devdigest/shared": path.resolve(__dirname, "src/vendor/shared"),
      "@devdigest/ui": path.resolve(__dirname, "src/vendor/ui"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Report only (no thresholds): `pnpm coverage`.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/vendor/**", "src/**/*.test.{ts,tsx}"],
      reporter: ["text-summary", "html"],
    },
  },
});
