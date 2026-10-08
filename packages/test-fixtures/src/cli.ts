import { downloadFixture } from "./download.ts";
import {
  fixturesDir,
  loadManifest,
  localFixtureDirs,
  type RemoteFixture,
  selectFixtures,
} from "./manifest.ts";

const concurrency = 3;
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

function selection(): RemoteFixture[] {
  try {
    return selectFixtures(loadManifest(), process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

const selected = selection();
const dir = fixturesDir();
const localDirs = localFixtureDirs();
const queue = [...selected];
const failed: string[] = [];

async function worker() {
  for (let fixture = queue.shift(); fixture; fixture = queue.shift()) {
    await fetchOne(fixture);
  }
}

async function fetchOne(fixture: RemoteFixture) {
  const started = performance.now();
  try {
    const result = await downloadFixture(fixture, dir, { localDirs });
    const seconds = ((performance.now() - started) / 1000).toFixed(0);
    const detail = result === "downloaded" ? ` in ${seconds} s` : "";
    console.log(`${result.padEnd(10)} ${fixture.file} (${megabytes(fixture.bytes)}${detail})`);
  } catch (error) {
    failed.push(fixture.file);
    console.error(
      `failed     ${fixture.file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(
  `${selected.length} fixtures, ${megabytes(selected.reduce((sum, f) => sum + f.bytes, 0))}, into ${dir}`,
);
await Promise.all(Array.from({ length: concurrency }, worker));
if (failed.length > 0) {
  console.error(`${failed.length} fixtures failed, run again to resume: ${failed.join(", ")}`);
  process.exitCode = 1;
}
