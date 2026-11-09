import { type PointerEvent, useEffect, useRef, useState } from "react";
import { type Navigation, previewMotion } from "../../devices/navigation.ts";

const tiles = Array.from({ length: 64 }, (_, index) => index);
const maxOctaves = 2.5;
const coastReach = 0.35;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Drag = { x: number; y: number; at: number; vx: number; vy: number };

export function FeelPreview({ navigation }: { navigation: Navigation }) {
  const motion = previewMotion(navigation, reducedMotion());
  const pad = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, octaves: 0 });
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [ease, setEase] = useState(motion.zoomMs);
  const drag = useRef<Drag | null>(null);
  const { anchor, zoomMs, zoomOctavesPerNotch } = motion;

  useEffect(() => {
    const element = pad.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      setOrigin(
        anchor === "cursor"
          ? {
              x: ((event.clientX - box.left) / box.width) * 100,
              y: ((event.clientY - box.top) / box.height) * 100,
            }
          : { x: 50, y: 50 },
      );
      setEase(zoomMs);
      const octaves = (event.deltaY / 100) * zoomOctavesPerNotch;
      setView((previous) => ({
        ...previous,
        octaves: Math.max(0, Math.min(maxOctaves, previous.octaves + octaves)),
      }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [anchor, zoomMs, zoomOctavesPerNotch]);

  const jump = () => {
    setEase(motion.jumpMs);
    setOrigin({ x: 50, y: 50 });
    setView((previous) => ({
      ...previous,
      x: previous.x === 0 ? -60 : 0,
      y: previous.y === 0 ? 24 : 0,
    }));
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, vx: 0, vy: 0 };
    setEase(0);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (held === null) return;
    const elapsed = Math.max(1, event.timeStamp - held.at);
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      vx: dx / elapsed,
      vy: dy / elapsed,
    };
    setView((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
  };

  const up = () => {
    const held = drag.current;
    drag.current = null;
    if (held === null || motion.coastMs === 0) return;
    setEase(motion.coastMs);
    setView((previous) => ({
      ...previous,
      x: previous.x + held.vx * motion.coastMs * coastReach,
      y: previous.y + held.vy * motion.coastMs * coastReach,
    }));
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div
        ref={pad}
        role="img"
        aria-label="Camera feel preview"
        data-testid="feel-preview"
        data-zoom-ms={motion.zoomMs}
        data-jump-ms={motion.jumpMs}
        data-coast-ms={motion.coastMs}
        data-anchor={motion.anchor}
        className="relative h-[120px] w-[280px] cursor-grab touch-none overflow-hidden rounded-md border border-line bg-chrome"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div
          className="absolute inset-0 grid grid-cols-8 gap-1 p-1"
          style={{
            transformOrigin: `${origin.x}% ${origin.y}%`,
            transform: `translate(${view.x}px, ${view.y}px) scale(${2 ** view.octaves})`,
            transition: ease === 0 ? "none" : `transform ${ease}ms ease-out`,
          }}
        >
          {tiles.map((index) => (
            <span
              key={index}
              className={
                (index + Math.floor(index / 8)) % 2 === 0 ? "bg-accent/40" : "bg-accent/15"
              }
            />
          ))}
        </div>
      </div>
      <button type="button" className="text-body-sm text-accent" onClick={jump}>
        Jump to another spot
      </button>
    </div>
  );
}
