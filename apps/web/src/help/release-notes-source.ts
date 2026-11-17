import changelog from "../../../../CHANGELOG.md?raw";
import { parseReleases } from "./release-notes.ts";

export const latestReleases = parseReleases(changelog, 2);
