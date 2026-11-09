import type { ReviewObject } from "@parfocal/api-client";
import { useMemo, useRef } from "react";
import { regionShapes } from "../screens/review/slide-geometry.ts";
import type { StillObject } from "./still-engine.tsx";
import { overviewFrame, ringOfPath, type StillFrame } from "./still-frame.ts";

type Decision = "agree" | "disagree" | "unsure";

const rings = new Map<string, Float32Array>();

function ringOfShape(key: string): Float32Array | null {
  const known = rings.get(key);
  if (known) return known;
  const shape = regionShapes[key];
  if (shape === undefined) return null;
  const ring = ringOfPath(shape.path);
  rings.set(key, ring);
  return ring;
}

export type SlideOutlines = ReadonlyMap<string, readonly number[]>;

function placedRing(item: ReviewObject): { ring: ArrayLike<number>; inSlide: boolean } | null {
  if (item.outline) return { ring: item.outline, inSlide: true };
  const ring = ringOfShape(item.object.replace("⁺", ""));
  return ring === null ? null : { ring, inSlide: false };
}

export function useStillObjects(
  objects: readonly ReviewObject[],
  decisionOf: (object: string) => Decision | undefined,
  exclude: string | null,
  slideSize: { width: number; height: number } | null = null,
): {
  objects: readonly StillObject[];
  ids: ReadonlySet<string>;
  outlines: SlideOutlines | undefined;
  frame: StillFrame | undefined;
} {
  const outlined = objects.flatMap((item): [string, readonly number[]][] =>
    item.kind === "region" && item.outline ? [[item.object, item.outline]] : [],
  );
  const outlineSignature = outlined.map(([id, ring]) => `${id}:${ring.join(",")}`).join("|");
  const kept = useRef<{ signature: string; value: readonly StillObject[] } | null>(null);
  const value = objects.flatMap((item): StillObject[] => {
    if (item.kind !== "region" || item.object === exclude) return [];
    const placed = placedRing(item);
    if (placed === null) return [];
    return [
      {
        id: item.object,
        ring: placed.ring,
        inSlide: placed.inSlide,
        className: item.class_name,
        score: item.score,
        decision: decisionOf(item.object) ?? null,
      },
    ];
  });
  const signature = value
    .map(
      (item) => `${item.id}:${item.className}:${item.score}:${item.decision ?? ""}:${item.inSlide}`,
    )
    .join("|")
    .concat("#", outlineSignature);
  if (kept.current?.signature !== signature) kept.current = { signature, value };
  const objectsNow = kept.current.value;
  const ids = useMemo(() => new Set(objectsNow.map((item) => item.id)), [objectsNow]);
  const keptOutlines = useRef<{ signature: string; value: SlideOutlines | undefined } | null>(null);
  if (keptOutlines.current?.signature !== outlineSignature) {
    keptOutlines.current = {
      signature: outlineSignature,
      value: outlined.length === 0 ? undefined : new Map(outlined),
    };
  }
  const width = slideSize?.width ?? 0;
  const height = slideSize?.height ?? 0;
  const frame = useMemo(
    () => (width > 0 && height > 0 ? overviewFrame({ width, height }) : undefined),
    [width, height],
  );
  return { objects: objectsNow, ids, outlines: keptOutlines.current.value, frame };
}
