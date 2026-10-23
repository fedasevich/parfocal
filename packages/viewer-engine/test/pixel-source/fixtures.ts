import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixturesDir, syntheticDir } from "@parfocal/test-fixtures";

export { syntheticDir };

export function cachedFixture(file: string): string | null {
  const path = join(fixturesDir(), file);
  return existsSync(`${path}.sha256`) ? path : null;
}

export function cachedFixtureDir(): string {
  return fixturesDir();
}
