import { SwipeHandle } from "@parfocal/ui/components/visualize";
import type { KeyboardEvent, PointerEvent } from "react";
import { splitAfterKey, splitFromPointer, splitPercent } from "./swipe-split.ts";

type SwipeDividerProps = {
  split: number;
  onSplit: (split: number) => void;
};

export function SwipeDivider({ split, onSplit }: SwipeDividerProps) {
  const moveTo = (event: PointerEvent<HTMLElement>) => {
    const stage =
      event.currentTarget.closest<HTMLElement>('[data-slot="slide-still"]') ??
      event.currentTarget.parentElement;
    if (stage === null) return;
    const box = stage.getBoundingClientRect();
    onSplit(splitFromPointer(event.clientX, box.left, box.width));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const next = splitAfterKey(split, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onSplit(next);
  };
  return (
    <SwipeHandle
      data-testid="swipe-divider"
      role="slider"
      tabIndex={0}
      aria-label="Swipe line between the two sets"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={splitPercent(split)}
      className="pointer-events-auto cursor-col-resize touch-none before:absolute before:inset-y-0 before:-inset-x-3 before:content-[''] focus-visible:outline-2 focus-visible:outline-accent-fill"
      style={{ left: `${split * 100}%` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event);
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={onKeyDown}
    />
  );
}
