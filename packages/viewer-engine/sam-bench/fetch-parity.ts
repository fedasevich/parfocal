import { downloadFixture, fixtureMirror, mirrorUrl } from "@parfocal/test-fixtures";
import type { SamProvider } from "../src/index.ts";
import { modelsDir, parityDir } from "./global-setup.ts";
import { loadParityFiles, parityDownloads } from "./parity-files.ts";

const providers = process.argv.slice(2) as SamProvider[];
const mirror = fixtureMirror();
if (mirror === undefined) {
  console.error("Set PARFOCAL_FIXTURES_R2_ENDPOINT, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY");
  process.exit(2);
}
const downloads = parityDownloads(
  loadParityFiles(),
  providers.length > 0 ? providers : ["webgpu", "wasm"],
  (key) => mirrorUrl(mirror, key, { expiresSeconds: 900 }),
);
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const total = downloads.reduce((sum, d) => sum + d.fixture.bytes, 0);
console.log(`${downloads.length} parity files, ${megabytes(total)}, from R2`);

for (const { fixture, into } of downloads) {
  const dir = into === "models" ? modelsDir() : parityDir();
  const result = await downloadFixture(fixture, dir);
  console.log(`${result.padEnd(10)} ${fixture.file} (${megabytes(fixture.bytes)})`);
}
