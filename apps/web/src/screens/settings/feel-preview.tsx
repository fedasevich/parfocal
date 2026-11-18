import { Trans, useLingui } from "@lingui/react/macro";
import type { PointerSample } from "@parfocal/viewer-engine";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { type Calibration, speedFactor } from "../../devices/calibration.ts";
import { type Navigation, previewMotion } from "../../devices/navigation.ts";
import { motionIsReduced } from "../../shell/motion.ts";
import {
  freshWheelState,
  jumpMs,
  previewMagnification,
  previewWheel,
  type Stick,
  stickPan,
  throwOf,
  type WheelState,
} from "./feel-model.ts";

const tiles = Array.from({ length: 64 }, (_, index) => index);
const padWidth = 280;
const stickRadius = 28;
const noStick: Stick = { x: 0, y: 0 };

export function FeelPreview({
  navigation,
  calibration,
}: {
  navigation: Navigation;
  calibration: Calibration;
}) {
  const { t } = useLingui();

  const reduced = motionIsReduced();
  const motion = previewMotion(navigation, reduced, calibration);
  const pad = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, octaves: 0 });
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [ease, setEase] = useState(motion.zoomMs);
  const [stick, setStick] = useState<Stick>(noStick);
  const pushed = stick.x !== 0 || stick.y !== 0;
  const wheel = useRef<WheelState>(freshWheelState);
  const samples = useRef<PointerSample[]>([]);
  const dragging = useRef(false);
  const stickNow = useRef<Stick>(noStick);
  const { anchor } = motion;

  const live = useRef({ navigation, calibration, reduced });
  live.current = { navigation, calibration, reduced };

  useEffect(() => {
    const element = pad.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { navigation: now, calibration: tuning } = live.current;
      const result = previewWheel(wheel.current, now, tuning, event, event.timeStamp);
      wheel.current = result.state;
      if (result.panDx !== 0 || result.panDy !== 0) {
        setEase(0);
        setView((previous) => ({
          ...previous,
          x: previous.x + result.panDx,
          y: previous.y + result.panDy,
        }));
        return;
      }
      const box = element.getBoundingClientRect();
      const zoomAnchor = previewMotion(now, live.current.reduced, tuning);
      setOrigin(
        zoomAnchor.anchor === "cursor"
          ? {
              x: ((event.clientX - box.left) / box.width) * 100,
              y: ((event.clientY - box.top) / box.height) * 100,
            }
          : { x: 50, y: 50 },
      );
      setEase(zoomAnchor.zoomMs);
      setView((previous) => ({ ...previous, octaves: result.state.octaves }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!pushed) return;
    let frame = 0;
    let last = performance.now();
    const tick = (at: number) => {
      const seconds = Math.min(0.1, (at - last) / 1000);
      last = at;
      const pan = stickPan(live.current.calibration, stickNow.current);
      if (pan.dx !== 0 || pan.dy !== 0) {
        setEase(0);
        setView((previous) => ({
          ...previous,
          x: previous.x + pan.dx * seconds,
          y: previous.y + pan.dy * seconds,
        }));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pushed]);

  const jump = () => {
    const toX = view.x === 0 ? -60 : 0;
    const toY = view.y === 0 ? 24 : 0;
    const length = Math.hypot(toX - view.x, toY - view.y) / padWidth;
    setEase(reduced ? 0 : jumpMs(navigation, calibration, length));
    setOrigin({ x: 50, y: 50 });
    setView((previous) => ({ ...previous, x: toX, y: toY }));
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    samples.current = [{ x: event.clientX, y: event.clientY, time: event.timeStamp }];
    setEase(0);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const previous = samples.current.at(-1);
    const dx = previous === undefined ? 0 : event.clientX - previous.x;
    const dy = previous === undefined ? 0 : event.clientY - previous.y;
    samples.current = [
      ...samples.current.slice(-6),
      { x: event.clientX, y: event.clientY, time: event.timeStamp },
    ];
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const thrown = reduced
      ? null
      : throwOf(samples.current, event.timeStamp, navigation, calibration);
    samples.current = [];
    if (thrown === null) return;
    setEase(thrown.ms);
    setView((current) => ({ ...current, x: current.x + thrown.dx, y: current.y + thrown.dy }));
  };

  const stickFrom = (event: PointerEvent<HTMLDivElement>): Stick => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - (box.left + box.width / 2)) / stickRadius;
    const y = (event.clientY - (box.top + box.height / 2)) / stickRadius;
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  };

  const setStickTo = (next: Stick) => {
    stickNow.current = next;
    setStick(next);
  };

  const halfPush = stickPan(calibration, { x: 0.5, y: 0 }).dx;
  const magnification = previewMagnification(view.octaves);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-start gap-3">
        <div
          ref={pad}
          role="img"
          aria-label={t`Camera feel preview`}
          data-testid="feel-preview"
          data-zoom-ms={motion.zoomMs}
          data-jump-ms={motion.jumpMs}
          data-coast-ms={motion.coastMs}
          data-anchor={motion.anchor}
          data-wheel-octaves={motion.zoomOctavesPerNotch.toFixed(4)}
          data-speed-factor={speedFactor(calibration.speed).toFixed(3)}
          data-half-push={Math.abs(Math.round(halfPush))}
          data-magnification={magnification.toFixed(1)}
          data-detents={navigation.objectiveDetents ? "on" : "off"}
          data-wheel-mode={navigation.wheel}
          data-origin={
            anchor === "cursor" ? `${Math.round(origin.x)},${Math.round(origin.y)}` : "centre"
          }
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
          <span
            data-testid="feel-magnification"
            className="absolute right-1.5 bottom-1 rounded-xs bg-canvas/80 px-1 font-mono text-caption text-fg"
          >
            {magnification.toFixed(1)}×
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div
            role="img"
            aria-label={t`Stick preview`}
            data-testid="feel-stick"
            data-dead-zone={calibration.deadZone}
            data-pushed={pushed ? "yes" : "no"}
            data-pan-rate={Math.round(Math.hypot(...Object.values(stickPan(calibration, stick))))}
            className="relative size-[64px] cursor-pointer touch-none rounded-full border border-line-strong bg-chrome"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setStickTo(stickFrom(event));
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 0) setStickTo(stickFrom(event));
            }}
            onPointerUp={() => setStickTo(noStick)}
            onPointerCancel={() => setStickTo(noStick)}
          >
            <span
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-fg-faint"
              style={{
                width: (calibration.deadZone / 100) * stickRadius * 2,
                height: (calibration.deadZone / 100) * stickRadius * 2,
              }}
            />
            <span
              className="absolute size-3 rounded-full bg-accent"
              style={{
                left: 32 + stick.x * stickRadius - 6,
                top: 32 + stick.y * stickRadius - 6,
              }}
            />
          </div>
          <span className="text-caption text-fg-dim">
            <Trans>Stick</Trans>
          </span>
        </div>
      </div>
      <button type="button" className="text-body-sm text-accent" onClick={jump}>
        <Trans>Jump to another spot</Trans>
      </button>
    </div>
  );
}
