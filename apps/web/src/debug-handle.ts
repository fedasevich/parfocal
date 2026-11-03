export type DebugCamera = { x: number; y: number; scale: number };

export type ParfocalHandle = {
  state?: unknown;
  getStats?: () => unknown;
  getSample?: () => unknown;
  getCamera?: () => DebugCamera | null;
  setCamera?: (camera: DebugCamera) => void;
  getRoute?: () => string;
  getLod?: () => number;
  editor?: unknown;
  segmenter?: unknown;
  probe?: unknown;
  learner?: unknown;
  comments?: unknown;
  getPyramid?: () => unknown;
  getPrediction?: () => unknown;
  pumpPrediction?: () => void;
  runBenchmark?: (zoom: number) => Promise<unknown>;
  getSampleCount?: () => number;
  csv?: () => string;
  measureThroughput?: (frames: number) => Promise<number>;
  setNuclei?: (count: number) => void;
  setCullMode?: (mode: string) => void;
  app?: unknown;
};

export type DebugHandleHost = { __parfocal?: ParfocalHandle };

declare global {
  interface Window {
    __parfocal?: ParfocalHandle;
  }
}

export const debugHandleName = "window.__parfocal";

export const parfocalMembers = [
  "state",
  "getStats",
  "getSample",
  "getCamera",
  "setCamera",
  "getRoute",
  "getLod",
  "editor",
  "segmenter",
  "probe",
  "learner",
  "comments",
  "getPyramid",
  "getPrediction",
  "pumpPrediction",
  "runBenchmark",
  "getSampleCount",
  "csv",
  "measureThroughput",
  "setNuclei",
  "setCullMode",
  "app",
] as const satisfies readonly (keyof ParfocalHandle)[];

type Unlisted = Exclude<keyof ParfocalHandle, (typeof parfocalMembers)[number]>;
export const everyMemberListed: Unlisted extends never ? true : never = true;

export function debugHandleEnabled(appEnv: string): boolean {
  return appEnv !== "prod";
}

export function installDebugHandle(host: DebugHandleHost, appEnv: string): boolean {
  if (!debugHandleEnabled(appEnv)) return false;
  host.__parfocal ??= {};
  return true;
}

export function provideDebug(
  part: ParfocalHandle,
  host: DebugHandleHost = globalThis as DebugHandleHost,
): () => void {
  const handle = host.__parfocal;
  if (handle === undefined) return () => undefined;
  Object.assign(handle, part);
  return () => {
    for (const key of Object.keys(part) as (keyof ParfocalHandle)[]) {
      if (handle[key] === part[key]) delete handle[key];
    }
  };
}
