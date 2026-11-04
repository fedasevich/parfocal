import { MapTrail, PeekHere, WholeSlidePeek } from "@parfocal/ui/components/smart-minimap";
import { useRef } from "react";
import { useBindings, usePersonalKeys } from "../../keys/personal-keys.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { lookUrl } from "../thumbnails.ts";
import { peekKeyStep } from "./peek-model.ts";
import { type AreaMark, PeekAreas } from "./slide-maps.tsx";
import { cropCentre, midViewport, seenPercent, seenTrail } from "./tool-geometry.ts";

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

export function SlidePeek({
  slideName,
  areas,
  checked,
  atCell,
  held,
  onClose,
  onPick,
}: {
  slideName: string;
  areas: AreaMark[];
  checked: string[];
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
      sub={`${slideName} · ${areas.length} tumor regions, ${checked.length} decided · ${seenPercent.peek}% of tissue seen`}
      held={held}
      onClose={onClose}
      onPick={onPick}
    >
      <MapTrail rects={seenTrail} opacity={0.28} />
      <PeekAreas areas={areas} checked={checked} />
      <PeekHere rect={here} />
    </WholeSlidePeek>
  );
}

export function usePeekKey(open: boolean, onOpen: (held: boolean) => void, onClose: () => void) {
  const closing = useRef(false);
  const mode = usePersonalKeys().wholeSlide ?? "both";
  const bindings = useBindings(["viewer"], open ? ["peek", "esc"] : ["peek"]);
  useHotkeys(bindings, (fired) => {
    const next = peekKeyStep(open, closing.current, fired, mode);
    closing.current = next.closing;
    if (next.effect === "close") onClose();
    else if (next.effect === "hold") onOpen(true);
    else if (next.effect === "latch") onOpen(false);
  });
}
