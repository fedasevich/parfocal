import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  fixturesDir,
  loadManifest,
  type RemoteFixture,
  requiredGroups,
  syntheticDir,
} from "./manifest.ts";

export { ChecksumError, type DownloadResult, downloadFixture, sha256Of } from "./download.ts";
export {
  cacheKey,
  defaultGroups,
  fixturesDir,
  type Group,
  groups,
  loadManifest,
  localFixtureDirs,
  type Manifest,
  parseManifest,
  type RemoteFixture,
  referenceTilesDir,
  requiredGroups,
  type SyntheticFixture,
  selectFixtures,
  syntheticDir,
} from "./manifest.ts";

function remoteFixture(file: string): RemoteFixture {
  const fixture = loadManifest().remote.find((entry) => entry.file === file);
  if (fixture === undefined) throw new Error(`${file} is not in fixtures.json`);
  return fixture;
}

function notDownloaded(fixture: RemoteFixture): string {
  return `${fixture.file} is not downloaded, run: pnpm fixtures ${fixture.groups.join(" ")}`;
}

export function fixturePath(file: string): string {
  const fixture = remoteFixture(file);
  const path = join(fixturesDir(), file);
  if (!existsSync(`${path}.sha256`)) throw new Error(notDownloaded(fixture));
  return path;
}

export function cachedFixture(file: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const fixture = remoteFixture(file);
  const path = join(fixturesDir(env), file);
  if (existsSync(`${path}.sha256`)) return path;
  const required = requiredGroups(env);
  if (fixture.groups.some((group) => required.has(group))) {
    throw new Error(`${notDownloaded(fixture)}, PARFOCAL_REQUIRE_FIXTURES needs it`);
  }
  return null;
}

export function skipUnlessCached(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): string | false {
  return cachedFixture(file, env) === null ? notDownloaded(remoteFixture(file)) : false;
}

export function syntheticPath(file: string): string {
  if (!loadManifest().synthetic.some((entry) => entry.file === file)) {
    throw new Error(`${file} is not a synthetic fixture in fixtures.json`);
  }
  return join(syntheticDir, file);
}
