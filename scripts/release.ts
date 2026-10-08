import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const versionPattern = /^v\d+\.\d+\.\d+$/;

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitCliff(args: string[]): string {
  return run("pnpm", ["exec", "git-cliff", ...args]);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (run("git", ["status", "--porcelain"]) !== "") fail("Commit or stash changes before a release.");
if (run("git", ["branch", "--show-current"]) !== "main") fail("Releases are cut from main.");
run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) {
  fail("main differs from origin/main. Pull or push first.");
}

const version = process.argv[2] ?? gitCliff(["--bumped-version"]);
if (!versionPattern.test(version)) fail(`${version} is not a version like v1.2.3.`);
if (run("git", ["tag", "--list", version]) !== "") fail(`${version} already exists.`);

gitCliff(["--tag", version, "--output", "CHANGELOG.md"]);
run("git", ["add", "CHANGELOG.md"]);
run("git", ["commit", "--quiet", "--message", `chore(release): ${version}`]);
run("git", ["tag", "--annotate", version, "--message", version]);
console.log(`Tagged ${version}. Publish it with: git push --follow-tags origin main`);
