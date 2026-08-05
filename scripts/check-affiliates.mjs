/**
 * Warns if affiliate placeholders are still in the docs. See AFFILIATES.md.
 * Deliberately non-fatal: shipping without affiliate IDs is a valid choice, but doing it
 * by accident is not.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hits = [];

for (const name of readdirSync(root)) {
  if (!name.endsWith(".md") || name === "AFFILIATES.md") continue;
  readFileSync(join(root, name), "utf-8")
    .split("\n")
    .forEach((line, i) => {
      if (line.includes("REPLACE_WITH_")) hits.push(`${name}:${i + 1}`);
    });
}

if (hits.length > 0) {
  console.warn(
    `\n  ⚠ ${hits.length} affiliate placeholder(s) still unreplaced:\n` +
      hits.map((h) => `      ${h}`).join("\n") +
      "\n    These links will credit nobody. See AFFILIATES.md.\n",
  );
}
