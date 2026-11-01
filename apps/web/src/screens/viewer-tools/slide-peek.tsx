import { MapTrail, PeekHere, WholeSlidePeek } from "@parfocal/ui/components/smart-minimap";
import { useEffect, useRef } from "react";
import { lookUrl } from "../thumbnails.ts";
import { type AreaMark, PeekAreas } from "./slide-maps.tsx";
import { cropCentre, midViewport, seenPercent, seenTrail } from "./tool-geometry.ts";

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

export function SlidePeek({
  slideName,
  areas,
  decided,
  atCell,
  held,
  onClose,
  onPick,
}: {
  slideName: string;
  areas: AreaMark[];
  decided: number;
  atCell: boolean;
  held: boolean;
  onClose: () => void;
  onPick: (point: [number, number]) => void;
}) {
  const here: [number, number, number, number] = atCell
    ? [cropCentre.hpf[0] - 14, cropCentre.hpf[1] - 9, 27, 17]
    : midViewport;
  return (
    <WholeSlidePeek
      image={overviewImage}
      sub={`${slideName} · ${areas.length} tumor regions, ${decided} decided · ${seenPercent.peek}% of tissue seen`}
      held={held}
      onClose={onClose}
      onPick={onPick}
    >
      <MapTrail rects={seenTrail} opacity={0.28} />
      <PeekAreas areas={areas} checked={["T1"]} />
      <PeekHere rect={here} />
    </WholeSlidePeek>
  );
}

const tapMs = 350;

export function usePeekKey(open: boolean, onOpen: (held: boolean) => void, onClose: () => void) {
  const pressed = useRef<number | null>(null);
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      Boolean((target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]"));
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === "Escape" && open) {
        onClose();
        return;
      }
      if (event.key !== "z" && event.key !== "Z") return;
      if (event.repeat) return;
      if (open) {
        onClose();
        return;
      }
      pressed.current = Date.now();
      onOpen(true);
    };
    const up = (event: KeyboardEvent) => {
      if ((event.key !== "z" && event.key !== "Z") || pressed.current === null) return;
      const held = Date.now() - pressed.current;
      pressed.current = null;
      if (held >= tapMs) onClose();
      else onOpen(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });
}
