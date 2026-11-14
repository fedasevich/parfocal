import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const baselineFile = fileURLToPath(
  new URL("./lint/raw-jsx-strings-baseline.json", import.meta.url),
);
const located = /^file:\/\/(.+?):\d+:\d+: error parfocal-i18n\(no-raw-jsx-strings\)/;

writeFileSync(baselineFile, "[]\n");
const run = spawnSync("pnpm", ["-s", "oxlint", "--quiet", "apps/web/src", "packages/ui/src"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
const files = new Set<string>();
for (const line of `${run.stdout}\n${run.stderr}`.split("\n")) {
  const found = located.exec(line);
  if (found?.[1] === undefined) continue;
  files.add(relative(repoRoot, decodeURIComponent(found[1])).split(sep).join("/"));
}
writeFileSync(baselineFile, `${JSON.stringify([...files].sort(), null, 2)}\n`);
console.log(`${files.size} files still hold raw JSX strings`);
