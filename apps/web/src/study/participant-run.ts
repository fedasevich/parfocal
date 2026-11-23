import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { DeviceStorage } from "../shell/device-settings.ts";

const runKey = "parfocal.study.run";

export const runPhases = ["consent", "intro", "task", "seq", "final", "done"] as const;

export type RunPhase = (typeof runPhases)[number];

const runSchema = z.object({
  code: z.string(),
  phase: z.enum(runPhases),
  sessionId: z.string().optional(),
  index: z.number().int().nonnegative(),
  taskStartedAt: z.number().optional(),
  finalStep: z.number().int().nonnegative(),
});

export type ParticipantRun = z.infer<typeof runSchema>;

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(random: () => number = Math.random): string {
  const letters = Array.from(
    { length: 4 },
    () => codeAlphabet[Math.floor(random() * codeAlphabet.length)] ?? "A",
  );
  return `P-${letters.join("")}`;
}

export const freshRun = (code = makeCode()): ParticipantRun => ({
  code,
  phase: "consent",
  index: 0,
  finalStep: 0,
});

const tabStorage = (): DeviceStorage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedRun: ParticipantRun | undefined;

export function readRun(storage = tabStorage()): ParticipantRun | undefined {
  try {
    const raw = storage?.getItem(runKey) ?? null;
    if (raw === cachedRaw) return cachedRun;
    cachedRaw = raw;
    const parsed = raw === null ? undefined : runSchema.safeParse(JSON.parse(raw));
    cachedRun = parsed?.success ? parsed.data : undefined;
    return cachedRun;
  } catch {
    return undefined;
  }
}

export function writeRun(run: ParticipantRun | undefined, storage = tabStorage()): void {
  try {
    if (run === undefined) storage?.removeItem(runKey);
    else storage?.setItem(runKey, JSON.stringify(run));
  } catch {
    storage?.removeItem(runKey);
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useParticipantRun = (): ParticipantRun | undefined =>
  useSyncExternalStore(subscribe, () => readRun());
