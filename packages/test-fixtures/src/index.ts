import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixturesDir, loadManifest, syntheticDir } from "./manifest.ts";

export { ChecksumError, type DownloadResult, downloadFixture, sha256Of } from "./download.ts";
export {
  defaultGroups,
  fixturesDir,
  type Group,
  groups,
  loadManifest,
  localFixtureDirs,
  type Manifest,
  parseManifest,
  type RemoteFixture,
  type SyntheticFixture,
  selectFixtures,
  syntheticDir,
} from "./manifest.ts";

export function fixturePath(file: string): string {
  const fixture = loadManifest().remote.find((entry) => entry.file === file);
  if (fixture === undefined) throw new Error(`${file} is not in fixtures.json`);
  const path = join(fixturesDir(), file);
  if (!existsSync(`${path}.sha256`)) {
    throw new Error(`${file} is not downloaded, run: pnpm fixtures ${fixture.groups[0]}`);
  }
  return path;
}

export function syntheticPath(file: string): string {
  if (!loadManifest().synthetic.some((entry) => entry.file === file)) {
    throw new Error(`${file} is not a synthetic fixture in fixtures.json`);
  }
  return join(syntheticDir, file);
}
