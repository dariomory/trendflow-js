import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const libraryEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node18",
  // The library is bundled in: this package is an executable, not something people import.
  // That also keeps the repo installable before `trendflow` is on the registry — a workspace
  // root cannot be linked as a workspace member, so declaring it as a dependency would make
  // `npm ci` fail until the version exists.
  noExternal: ["trendflow"],
  external: ["@modelcontextprotocol/sdk", "zod", "undici"],
  esbuildOptions(options) {
    options.alias = { ...options.alias, trendflow: libraryEntry };
  },
});
