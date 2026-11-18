import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureBucket, fixturePrefix, presignUrl } from "@parfocal/test-fixtures";
import {
  baselineDirectory,
  baselineListPath,
  listBaselines,
  publishBaselines,
  serializeBaselineList,
  type Uploader,
  writeBaselineList,
} from "./visual-baselines.ts";

const [command, ...args] = process.argv.slice(2);

function writeUploader(dryRun: boolean): Uploader {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!dryRun && (!endpoint || !accessKeyId || !secretAccessKey)) {
    console.error("Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, or pass --dry-run");
    process.exit(2);
  }
  return async (key, body) => {
    if (dryRun) return "stored";
    const url = presignUrl(
      `${endpoint}/${fixtureBucket}/${fixturePrefix}${key}`,
      { accessKeyId: accessKeyId ?? "", secretAccessKey: secretAccessKey ?? "" },
      { method: "PUT", expiresSeconds: 900 },
    );
    const response = await fetch(url, {
      method: "PUT",
      headers: { "if-none-match": "*", "content-type": "image/png" },
      body: new Uint8Array(body),
    });
    if (response.status === 412) return "exists";
    if (!response.ok) throw new Error(`PUT ${key}: HTTP ${response.status}`);
    return "stored";
  };
}

if (command === "list") {
  const [directory, output] = args;
  if (directory === undefined || output === undefined) {
    console.error("Usage: visual-baselines-cli.ts list DIRECTORY OUTPUT.json");
    process.exit(2);
  }
  const list = await listBaselines(resolve(directory));
  await writeFile(resolve(output), serializeBaselineList(list));
  console.log(`${list.length} baselines listed in ${output}`);
} else if (command === "publish") {
  const dryRun = args.includes("--dry-run");
  const directory = args.find((arg) => !arg.startsWith("--"));
  if (directory === undefined) {
    console.error("Usage: visual-baselines-cli.ts publish DIRECTORY [--dry-run]");
    process.exit(2);
  }
  const { list, stored, existing } = await publishBaselines(
    resolve(directory),
    writeUploader(dryRun),
  );
  await writeBaselineList(list);
  const verb = dryRun ? "would store" : "stored";
  console.log(`${list.length} baselines, ${verb} ${stored}, already in R2 ${existing}`);
  console.log(`Wrote ${fileURLToPath(baselineListPath)}. Commit it.`);
} else {
  console.error(
    `Usage: visual-baselines-cli.ts list|publish. Baselines go to ${fileURLToPath(baselineDirectory)}`,
  );
  process.exit(2);
}
