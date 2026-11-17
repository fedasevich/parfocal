import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const draftFolder = fileURLToPath(
  new URL("../packages/api-client/src/draft", import.meta.url),
);

const operationsByArea: Record<string, string[]> = {
  project: [
    "getProjectOverview",
    "listProjectSlides",
    "getProjectImports",
    "getProjectScopeOptions",
    "getReviewTaskDefaults",
    "requestProjectAccess",
    "getUploadBatch",
  ],
  viewer: [],
  review: [],
  reports: [
    "getEvaluationReport",
    "getClinicalReport",
    "getCosignReview",
    "cosignClinicalReport",
    "returnCosignRequest",
  ],
  models: [
    "getModelRunDefaults",
    "moveModelRun",
    "getLabModelConnection",
    "listStudyTemplateReviewDefaults",
    "listAiModels",
  ],
  team: ["listTeamWorkload", "listReviewerWorkload"],
  admin: ["getAdminOverview", "getStorageUsage", "getSecuritySettings", "listWebhooks"],
  "sign-in": [
    "getInvitePreview",
    "getSignInOptions",
    "signInWithCode",
    "requestSignInLink",
    "startSso",
    "requestPasswordReset",
    "resetPassword",
  ],
};

const areaOf = new Map<string, string>(
  Object.entries(operationsByArea).flatMap(([area, operations]) =>
    operations.map((operation): [string, string] => [operation, area]),
  ),
);

const declaration = /defineDraft(?:Query|Mutation)\(\s*"([^"]+)"/g;

export type DraftCount = { areas: Record<string, string[]>; total: number };

export function countDraftCalls(folder: string = draftFolder): DraftCount {
  const areas: Record<string, string[]> = {};
  for (const name of readdirSync(folder).sort()) {
    const source = readFileSync(join(folder, name), "utf8");
    for (const match of source.matchAll(declaration)) {
      const operation = match[1] as string;
      const area = areaOf.get(operation) ?? "other";
      areas[area] = [...(areas[area] ?? []), operation];
    }
  }
  const total = Object.values(areas).reduce((sum, operations) => sum + operations.length, 0);
  return { areas, total };
}

export function formatDraftCount(count: DraftCount): string {
  const lines = Object.keys(count.areas)
    .sort()
    .map((area) => `  ${area}: ${count.areas[area]?.length ?? 0}`);
  return ["draft calls per area", ...lines, `  total: ${count.total}`].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(formatDraftCount(countDraftCalls()));
}
