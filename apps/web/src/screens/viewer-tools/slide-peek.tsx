import { MapTrail, PeekHere, WholeSlidePeek } from "@parfocal/ui/components/smart-minimap";
import { useRef } from "react";
import { useBindings } from "../../keys/personal-keys.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
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

export function usePeekKey(open: boolean, onOpen: (held: boolean) => void, onClose: () => void) {
  const closing = useRef(false);
  const bindings = useBindings(["viewer"], open ? ["peek", "esc"] : ["peek"]);
  useHotkeys(bindings, ({ action, phase }) => {
    if (action === "esc") {
      if (open) onClose();
      return;
    }
    if (phase === "hold-start") {
      closing.current = open;
      if (open) onClose();
      else onOpen(true);
      return;
    }
    if (closing.current) {
      closing.current = false;
      return;
    }
    if (phase === "tap") onOpen(false);
    else if (phase === "hold-end") onClose();
  });
}
