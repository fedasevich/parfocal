import changelog from "../../../../CHANGELOG.md?raw";
import { newestVersion, parseReleases } from "./release-notes.ts";

export const allReleases = parseReleases(changelog);

export const appVersion = newestVersion(changelog);
