import type { CDPSession } from "@playwright/test";
import { harnessOriginVariable } from "./global-setup.ts";

export function harnessUrl(path: string): string {
  const origin = process.env[harnessOriginVariable];
  if (!origin)
    throw new Error("The harness server is not running. Run the specs through playwright test");
  return `${origin}${path}`;
}

export async function collectGarbage(cdp: CDPSession): Promise<void> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
}

export async function heapBytes(cdp: CDPSession): Promise<number> {
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
}

export async function liveObjects(cdp: CDPSession, prototype: string): Promise<number> {
  const handle = await cdp.send("Runtime.evaluate", { expression: prototype });
  const objectId = handle.result.objectId;
  if (!objectId) return 0;
  const found = await cdp.send("Runtime.queryObjects", { prototypeObjectId: objectId });
  const foundId = found.objects.objectId;
  await cdp.send("Runtime.releaseObject", { objectId });
  if (!foundId) return 0;
  const length = await cdp.send("Runtime.callFunctionOn", {
    objectId: foundId,
    functionDeclaration: "function () { return this.length; }",
    returnByValue: true,
  });
  await cdp.send("Runtime.releaseObject", { objectId: foundId });
  return Number(length.result.value);
}
