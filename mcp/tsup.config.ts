import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node18",
  // `trendflow` is a declared dependency and stays external — the output imports it.
  external: ["trendflow", "@modelcontextprotocol/sdk", "zod"],
});
