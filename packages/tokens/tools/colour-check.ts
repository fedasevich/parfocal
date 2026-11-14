import { check, formatFindings } from "../src/colour-check.ts";
import { loadCheckInput } from "./colour-sources.ts";

const findings = check(loadCheckInput());
console.log(formatFindings(findings));

const failed = findings.filter((finding) => !finding.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} colour checks failed`);
  process.exitCode = 1;
}
