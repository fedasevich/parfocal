import { fileURLToPath } from "node:url";
import { goldenUpdateRequested } from "@parfocal/golden-images";
import { fixtureMirror, mirrorUrl } from "@parfocal/test-fixtures";
import {
  baselineDirectory,
  fetchBaselines,
  loadBaselineList,
} from "../scripts/visual-baselines.ts";

export default async function fetchVisualBaselines() {
  if (goldenUpdateRequested()) return;
  const list = await loadBaselineList();
  if (list.length === 0) return;
  const mirror = fixtureMirror();
  if (mirror === undefined) {
    if (process.env.PARFOCAL_REQUIRE_VISUAL === "1") {
      throw new Error(
        "UI visual baselines live in R2. Set PARFOCAL_FIXTURES_R2_ENDPOINT, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY",
      );
    }
    console.warn("UI visual baselines not fetched, no R2 key set. The visual tests will skip.");
    return;
  }
  const counts = await fetchBaselines(fileURLToPath(baselineDirectory), list, (key) =>
    mirrorUrl(mirror, key, { expiresSeconds: 3600 }),
  );
  console.log(
    `UI visual baselines verified against visual-baselines.json: ${counts.cached} cached, ${counts.downloaded} downloaded`,
  );
}
