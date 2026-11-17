import { z } from "zod";
import type { DeviceStorage } from "../shell/device-settings.ts";
import { type ActiveGuard, parseState, type StudyState } from "./study-model.ts";

const studyKey = "parfocal.study";
const guardKey = "parfocal.study.guard";
const blocksKey = "parfocal.study.blocks";

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

const guardSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
  where: z.string(),
  stayOn: z.array(z.string()),
});

const blockLogSchema = z.array(
  z.object({
    sessionId: z.string(),
    taskId: z.string(),
    at: z.number(),
    to: z.string(),
  }),
);

export type BlockLogEntry = z.infer<typeof blockLogSchema>[number];

export function readGuard(storage = browserStorage()): ActiveGuard | undefined {
  try {
    const raw = storage?.getItem(guardKey);
    if (raw === null || raw === undefined) return undefined;
    const parsed = guardSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeGuard(guard: ActiveGuard | undefined, storage = browserStorage()): void {
  try {
    if (guard === undefined) storage?.removeItem(guardKey);
    else storage?.setItem(guardKey, JSON.stringify(guard));
  } catch {
    storage?.removeItem(guardKey);
  }
}

export function readBlockLog(storage = browserStorage()): BlockLogEntry[] {
  try {
    const parsed = blockLogSchema.safeParse(JSON.parse(storage?.getItem(blocksKey) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function appendBlock(entry: BlockLogEntry, storage = browserStorage()): void {
  try {
    storage?.setItem(blocksKey, JSON.stringify([...readBlockLog(storage), entry]));
  } catch {
    storage?.removeItem(blocksKey);
  }
}

export function clearBlockLog(storage = browserStorage()): void {
  try {
    storage?.removeItem(blocksKey);
  } catch {
    return;
  }
}
