import {
  dragHeight,
  isNextCellSwipe,
  type SheetHeight,
  type SheetPixels,
  settleHeight,
} from "@parfocal/ui/lib/sheet-gesture";
import { cn } from "@parfocal/ui/lib/utils";
import { type PointerEvent, type ReactNode, useRef, useState } from "react";

type BottomSheetProps = {
  label: string;
  height: SheetHeight;
  onHeightChange: (height: SheetHeight) => void;
  onNextCell?: () => void;
  pixels?: SheetPixels;
  children: ReactNode;
};

const defaultPixels: SheetPixels = { peek: 88, half: 420, full: 720 };

const tapSlop = 6;

type Press = { x: number; y: number; time: number; startPx: number };

function BottomSheet({
  label,
  height,
  onHeightChange,
  onNextCell,
  pixels = defaultPixels,
  children,
}: BottomSheetProps) {
  const [livePx, setLivePx] = useState<number | null>(null);
  const handlePress = useRef<Press | null>(null);
  const bodyPress = useRef<Press | null>(null);

  const press = (event: PointerEvent): Press => ({
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
    startPx: pixels[height],
  });

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    handlePress.current = press(event);
  };

  const moveDrag = (event: PointerEvent) => {
    const start = handlePress.current;
    if (start) setLivePx(dragHeight(start.startPx, start.y - event.clientY, pixels));
  };

  const endDrag = (event: PointerEvent) => {
    const start = handlePress.current;
    handlePress.current = null;
    setLivePx(null);
    if (!start) return;
    const upward = start.y - event.clientY;
    if (Math.abs(upward) < tapSlop) return;
    const velocity = upward / Math.max(1, event.timeStamp - start.time);
    onHeightChange(
      settleHeight(height, dragHeight(start.startPx, upward, pixels), velocity, pixels),
    );
  };

  const endSwipe = (event: PointerEvent) => {
    const start = bodyPress.current;
    bodyPress.current = null;
    if (
      start &&
      isNextCellSwipe(
        event.clientX - start.x,
        event.clientY - start.y,
        event.timeStamp - start.time,
      )
    ) {
      onNextCell?.();
    }
  };

  const nextHeight = (): SheetHeight =>
    height === "peek" ? "half" : height === "half" ? "full" : "peek";

  return (
    <section
      aria-label={label}
      data-slot="bottom-sheet"
      data-height={height}
      data-dragging={livePx === null ? undefined : ""}
      className={cn(
        "absolute right-0 bottom-0 left-0 z-12 flex flex-col rounded-t-lg border-t border-line bg-chrome shadow-pop",
        livePx === null && "transition-[height] duration-(--motion-fast)",
      )}
      style={{ height: livePx ?? pixels[height] }}
    >
      <button
        type="button"
        aria-label="Resize the panel"
        data-slot="bottom-sheet-handle"
        className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => onHeightChange(nextHeight())}
      >
        <span className="h-1 w-10 rounded-full bg-line" />
      </button>
      <div
        data-slot="bottom-sheet-body"
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto"
        onPointerDown={(event) => {
          bodyPress.current = press(event);
        }}
        onPointerUp={endSwipe}
        onPointerCancel={() => {
          bodyPress.current = null;
        }}
      >
        {children}
      </div>
    </section>
  );
}

export { BottomSheet };
