import type { ReviewObject } from "@parfocal/api-client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TypeId, TypeOption } from "../screens/review/type-bar.ts";
import { TypeBar } from "../screens/review/type-bar.tsx";
import { outlineCentre, slideToScreen } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export function StageCellTypeBar({
  engine,
  cell,
  chosen,
  onChoose,
}: {
  engine: ViewerEngine;
  cell: ReviewObject;
  chosen: TypeId | undefined;
  onChoose: (option: TypeOption) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const spot = outlineCentre(cell.outline);
  const ready = spot !== null && size.width > 0;
  return (
    <div ref={frame} className="pointer-events-none absolute inset-0">
      {ready ? (
        <TypeBar
          object={cell.object}
          centre={slideToScreen(spot, camera, size)}
          scale={1}
          radius={spot.radius * 2 ** camera.zoom}
          size={size}
          chosen={chosen}
          onChoose={onChoose}
        />
      ) : null}
    </div>
  );
}
