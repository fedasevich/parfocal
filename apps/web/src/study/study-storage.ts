import type { DeviceStorage } from "../shell/device-settings.ts";
import { parseState, type StudyState } from "./study-model.ts";

const studyKey = "parfocal.study";

const browserStorage = (): DeviceStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function readStudy(storage = browserStorage()): StudyState {
  try {
    return parseState(storage?.getItem(studyKey) ?? null);
  } catch {
    return parseState(null);
  }
}

export function writeStudy(state: StudyState, storage = browserStorage()): void {
  try {
    storage?.setItem(studyKey, JSON.stringify(state));
  } catch {
    storage?.removeItem(studyKey);
  }
}
