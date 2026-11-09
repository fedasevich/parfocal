import type { ReviewObject } from "@parfocal/api-client";
import { useMemo, useRef } from "react";
import { regionShapes } from "../screens/review/slide-geometry.ts";
import type { StillObject } from "./still-engine.tsx";
import { ringOfPath } from "./still-frame.ts";

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

export function useStillObjects(
  objects: readonly ReviewObject[],
  decisionOf: (object: string) => Decision | undefined,
  exclude: string | null,
): { objects: readonly StillObject[]; ids: ReadonlySet<string> } {
  const kept = useRef<{ signature: string; value: readonly StillObject[] } | null>(null);
  const value = objects.flatMap((item): StillObject[] => {
    if (item.kind !== "region" || item.object === exclude) return [];
    const ring = ringOfShape(item.object.replace("⁺", ""));
    if (ring === null) return [];
    return [
      {
        id: item.object,
        ring,
        className: item.class_name,
        score: item.score,
        decision: decisionOf(item.object) ?? null,
      },
    ];
  });
  const signature = value
    .map((item) => `${item.id}:${item.className}:${item.score}:${item.decision ?? ""}`)
    .join("|");
  if (kept.current?.signature !== signature) kept.current = { signature, value };
  const objectsNow = kept.current.value;
  const ids = useMemo(() => new Set(objectsNow.map((item) => item.id)), [objectsNow]);
  return { objects: objectsNow, ids };
}
