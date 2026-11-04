import type { ResultSetKey } from "./scenario.ts";

export type ScenarioTyper = {
  name: string;
  calibrated: boolean;
  checkedOnHeldOut: boolean;
  bandAccuracy: { confident?: number; likely?: number; unsure?: number; doubtful?: number };
  testSetAccuracy: number | null;
  testSetConfidentShare: number | null;
  testSetUnsureShare: number | null;
  validatedSites: string[];
};

export const typers: Partial<Record<ResultSetKey, ScenarioTyper>> = {
  cam: {
    name: "CAMELYON",
    calibrated: true,
    checkedOnHeldOut: true,
    bandAccuracy: { confident: 0.97, likely: 0.84, unsure: 0.61, doubtful: 0.48 },
    testSetAccuracy: 0.93,
    testSetConfidentShare: 0.62,
    testSetUnsureShare: 0.12,
    validatedSites: [],
  },
  sam: {
    name: "HoVer-NeXt",
    calibrated: true,
    checkedOnHeldOut: true,
    bandAccuracy: { confident: 0.94, likely: 0.78, unsure: 0.55, doubtful: 0.41 },
    testSetAccuracy: 0.66,
    testSetConfidentShare: 0.48,
    testSetUnsureShare: 0.2,
    validatedSites: [],
  },
};
