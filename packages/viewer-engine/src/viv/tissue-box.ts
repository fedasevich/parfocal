import type { SlideArea } from "../camera/camera.ts";
import { absoluteUrl } from "../pixel-source/url.ts";

export const TISSUE_FILE = "tissue.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readTissueBox(document: unknown): SlideArea | null {
  if (!isRecord(document) || !isRecord(document.box)) return null;
  const { x, y, width, height } = document.box;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return { x, y, width, height };
}

export interface TissueFetchOptions {
  readonly url: string | URL;
  readonly baseUrl?: string | URL;
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export async function fetchTissueBox(options: TissueFetchOptions): Promise<SlideArea | null> {
  const fetcher = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetcher(absoluteUrl(options.url, options.baseUrl), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return null;
    return readTissueBox(await response.json());
  } catch {
    return null;
  }
}
