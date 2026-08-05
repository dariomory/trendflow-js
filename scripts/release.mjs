/**
 * Tag the current version and create a GitHub release.
 *
 * Pushing the tag is what triggers .github/workflows/publish.yml, which builds, verifies the
 * tag matches package.json, and publishes to npm with provenance. Nothing is published from
 * a developer machine.
 *
 *   npm run release
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(...cmd) {
  console.log(`$ ${cmd.join(" ")}`);
  execFileSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
}

const { name, version } = JSON.parse(readFileSync("package.json", "utf-8"));
const tag = `v${version}`;

// Release notes: the section of CHANGELOG.md for this version, up to the next heading.
const changelog = readFileSync("CHANGELOG.md", "utf-8");
const start = changelog.indexOf(`## ${version}`);
if (start === -1) {
  console.error(`No "## ${version}" section in CHANGELOG.md`);
  process.exit(1);
}
const rest = changelog.slice(start + `## ${version}`.length);
const end = rest.indexOf("\n## ");
const notes = (end === -1 ? rest : rest.slice(0, end)).trim();

run("git", "tag", "-a", tag, "-m", `Release ${tag}`);
run("git", "push", "origin", tag);
run(
  "gh",
  "release",
  "create",
  tag,
  "--verify-tag",
  "--title",
  `${name} ${version}`,
  "--notes",
  notes,
);
