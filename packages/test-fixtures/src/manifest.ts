import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const groups = ["small", "formats", "big", "huge", "camelyon"] as const;
export type Group = (typeof groups)[number];

export type RemoteFixture = {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  groups: Group[];
};

export type SyntheticFixture = {
  file: string;
  sha256: string;
  bytes: number;
};

export type Manifest = {
  remote: RemoteFixture[];
  synthetic: SyntheticFixture[];
};

export const packageDir = join(import.meta.dirname, "..");
export const manifestPath = join(packageDir, "fixtures.json");
export const syntheticDir = join(packageDir, "synthetic");
export const defaultGroups: Group[] = ["small"];

const sha256Pattern = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGroup(value: unknown): value is Group {
  return groups.some((group) => group === value);
}

function isSynthetic(value: unknown): value is SyntheticFixture {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    typeof value.sha256 === "string" &&
    sha256Pattern.test(value.sha256) &&
    typeof value.bytes === "number" &&
    Number.isInteger(value.bytes) &&
    value.bytes > 0
  );
}

function hasRemoteFields(value: Record<string, unknown>): boolean {
  const { url, groups: fixtureGroups } = value;
  return (
    typeof url === "string" &&
    url.startsWith("https://") &&
    Array.isArray(fixtureGroups) &&
    fixtureGroups.length > 0 &&
    fixtureGroups.every(isGroup)
  );
}

function isRemote(value: unknown): value is RemoteFixture {
  return isRecord(value) && hasRemoteFields(value) && isSynthetic(value);
}

export function parseManifest(text: string): Manifest {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !Array.isArray(data.remote) || !Array.isArray(data.synthetic)) {
    throw new Error("fixtures.json needs a remote and a synthetic list");
  }
  const remote: RemoteFixture[] = [];
  for (const entry of data.remote) {
    if (!isRemote(entry)) throw new Error(`invalid remote fixture: ${JSON.stringify(entry)}`);
    remote.push(entry);
  }
  const synthetic: SyntheticFixture[] = [];
  for (const entry of data.synthetic) {
    if (!isSynthetic(entry)) throw new Error(`invalid synthetic fixture: ${JSON.stringify(entry)}`);
    synthetic.push(entry);
  }
  const names = [...remote, ...synthetic].map((fixture) => fixture.file);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) throw new Error(`fixture ${duplicate} is listed twice`);
  return { remote, synthetic };
}

export function loadManifest(): Manifest {
  return parseManifest(readFileSync(manifestPath, "utf8"));
}

export function selectFixtures(manifest: Manifest, requested: readonly string[]): RemoteFixture[] {
  const names = requested.length > 0 ? requested : defaultGroups;
  if (names.includes("all")) return manifest.remote;
  const unknown = names.filter((name) => !isGroup(name));
  if (unknown.length > 0) {
    throw new Error(`unknown fixture group ${unknown.join(", ")}, use ${groups.join(", ")} or all`);
  }
  return manifest.remote.filter((fixture) => fixture.groups.some((group) => names.includes(group)));
}

export function fixturesDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PARFOCAL_FIXTURES_DIR;
  if (override) return override;
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "parfocal", "fixtures");
}

export function localFixtureDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PARFOCAL_FIXTURES_LOCAL ?? "").split(delimiter).filter((dir) => dir.length > 0);
}
