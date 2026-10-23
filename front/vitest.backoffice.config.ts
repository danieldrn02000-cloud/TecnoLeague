import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["test/backoffice.integration.tsx"],
    environment: "node",
    fileParallelism: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
