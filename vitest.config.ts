import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The mcp workspace owns its own tests and runs them with its own config.
    exclude: ["**/node_modules/**", "**/dist/**", "mcp/**"],
  },
});
