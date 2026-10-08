import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gitCliffBin = join(repoRoot, "node_modules/.bin/git-cliff");

function commitlint(message: string) {
  return spawnSync("pnpm", ["exec", "commitlint"], {
    cwd: repoRoot,
    input: message,
    encoding: "utf8",
  });
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function gitCliff(cwd: string, ...args: string[]) {
  const result = spawnSync(gitCliffBin, ["--config", join(repoRoot, "cliff.toml"), ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("commitlint accepts conventional messages with a backlog scope", () => {
  for (const message of [
    "feat(FOUND-017): Add release versioning",
    "fix: Pin setup-uv to a full version tag",
    "docs(STACK-013, STACK-018): Decide monorepo and Python tooling",
    "feat(VIEW-001)!: Replace the camera API",
    "chore(release): v0.2.0",
  ]) {
    const result = commitlint(message);
    assert.equal(result.status, 0, `${message}\n${result.stdout}`);
  }
});

test("commitlint rejects messages without a type", () => {
  for (const message of ["FOUND-016: Add slide fixtures", "Tick FOUND-016", "feature: Add x"]) {
    assert.notEqual(commitlint(message).status, 0, message);
  }
});

test("git-cliff bumps the version and groups the changelog per release tag", () => {
  const repo = mkdtempSync(join(tmpdir(), "release-"));
  try {
    git(repo, "init", "--quiet", "--initial-branch=main");
    git(repo, "config", "user.email", "release@example.org");
    git(repo, "config", "user.name", "Release test");
    const commit = (message: string) =>
      git(repo, "commit", "--quiet", "--allow-empty", "-m", message);

    commit("init");
    commit("feat(FOUND-001): Add the skeleton");
    assert.equal(gitCliff(repo, "--bumped-version"), "v0.1.0");
    git(repo, "tag", "--annotate", "v0.1.0", "--message", "v0.1.0");

    commit("fix(FOUND-007): Repair the cache key");
    assert.equal(gitCliff(repo, "--bumped-version"), "v0.1.1");
    commit("feat(FOUND-017): Add releases");
    commit("Tick FOUND-017");
    assert.equal(gitCliff(repo, "--bumped-version"), "v0.2.0");
    git(repo, "tag", "--annotate", "v0.2.0", "--message", "v0.2.0");

    const changelog = gitCliff(repo);
    assert.match(
      changelog,
      /## v0\.2\.0 \(\d{4}-\d{2}-\d{2}\)\n\n### Features\n\n- FOUND-017: Add releases\n\n### Fixes\n\n- FOUND-007: Repair the cache key/,
    );
    assert.match(changelog, /## v0\.1\.0 [^\n]*\n\n### Features\n\n- FOUND-001: Add the skeleton/);
    assert.doesNotMatch(changelog, /Tick FOUND-017|init/);

    const notes = gitCliff(repo, "--latest", "--strip", "header");
    assert.match(notes, /^## v0\.2\.0/);
    assert.doesNotMatch(notes, /v0\.1\.0/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
