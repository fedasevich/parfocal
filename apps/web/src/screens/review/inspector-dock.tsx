import { BottomSheet } from "@parfocal/ui/components/bottom-sheet";
import { TabCount } from "@parfocal/ui/components/tabs";
import type { SheetHeight, SheetPixels } from "@parfocal/ui/lib/sheet-gesture";
import { cn } from "@parfocal/ui/lib/utils";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import {
  dragInspector,
  type InspectorLayout,
  inspectorMaxWidth,
  inspectorMinWidth,
} from "./inspector-layout.ts";
import { useCoarsePointer } from "./use-coarse-pointer.ts";

type InspectorDockProps = {
  layout: InspectorLayout;
  onLayout: (patch: Partial<InspectorLayout>) => void;
  panning: boolean;
  tabLabel: string;
  tabCount: number | undefined;
  children: ReactNode;
};

const keyStep = 20;

const peekPixels = 88;

function sheetPixels(): SheetPixels {
  const available = window.innerHeight;
  return {
    peek: peekPixels,
    half: Math.round(available * 0.4),
    full: Math.round(available * 0.85),
  };
}

export function InspectorDock({
  layout,
  onLayout,
  panning,
  tabLabel,
  tabCount,
  children,
}: InspectorDockProps) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const edge = useRef<number>(0);
  const width = dragWidth ?? layout.width;
  const collapsed = dragWidth !== null && dragWidth < 220;
  const coarse = useCoarsePointer();
  const [sheetHeight, setSheetHeight] = useState<SheetHeight>("peek");

  if (layout.hidden) {
    return (
      <button
        type="button"
        data-testid="inspector-tab"
        aria-label={`Show the side panel, ${tabLabel}${tabCount ? `, ${tabCount}` : ""}`}
        onClick={() => onLayout({ hidden: false })}
        className="absolute top-3 right-0 z-10 flex cursor-pointer items-center gap-1.5 rounded-l-ctl border border-r-0 border-line bg-chrome px-2.5 py-2 text-body-sm font-semibold text-fg shadow-sm hover:bg-chrome-2"
      >
        <span>{tabLabel}</span>
        {tabCount ? <TabCount>{tabCount}</TabCount> : null}
      </button>
    );
  }

  if (coarse) {
    return (
      <BottomSheet
        label="Side panel"
        height={sheetHeight}
        onHeightChange={setSheetHeight}
        pixels={sheetPixels()}
      >
        <div
          data-testid="inspector-dock"
          className="flex min-h-full min-w-0 flex-col [&>aside]:w-full! [&>aside]:flex-1"
        >
          <div className="flex items-center gap-1.5 px-4 pb-2 text-body-sm font-semibold">
            <span>{tabLabel}</span>
            {tabCount ? <TabCount>{tabCount}</TabCount> : null}
          </div>
          {children}
        </div>
      </BottomSheet>
    );
  }

  const start = (event: PointerEvent<HTMLHRElement>) => {
    const parent = event.currentTarget.parentElement?.getBoundingClientRect();
    edge.current = parent?.right ?? window.innerWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragWidth(layout.width);
  };
  const move = (event: PointerEvent<HTMLHRElement>) => {
    if (dragWidth === null) return;
    setDragWidth(edge.current - event.clientX);
  };
  const end = (event: PointerEvent<HTMLHRElement>) => {
    if (dragWidth === null) return;
    const next = dragInspector(edge.current - event.clientX);
    setDragWidth(null);
    onLayout(next);
  };
  const press = (event: KeyboardEvent<HTMLHRElement>) => {
    const sign = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (sign === 0) return;
    event.preventDefault();
    onLayout(dragInspector(layout.width + sign * keyStep));
  };

  return (
    <div
      data-testid="inspector-dock"
      data-hidden-while-panning={panning ? "true" : undefined}
      className={cn(
        "relative isolate flex min-h-0 shrink-0",
        panning && "pointer-events-none opacity-0",
        collapsed && "opacity-50",
      )}
      style={{ width: collapsed ? 0 : width }}
    >
      <hr
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuemin={inspectorMinWidth}
        aria-valuemax={inspectorMaxWidth}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDragWidth(null)}
        onKeyDown={press}
        onDoubleClick={() => onLayout({ width: 340 })}
        className="absolute inset-y-0 -left-1 z-10 m-0 h-auto w-2 cursor-col-resize border-0 touch-none hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden [&>aside]:w-full!">{children}</div>
        <label className="flex cursor-pointer items-center gap-2 border-t border-l border-line bg-chrome px-3 py-1.5 text-caption text-fg-dim">
          <input
            type="checkbox"
            checked={layout.hideWhilePanning}
            onChange={(event) => onLayout({ hideWhilePanning: event.currentTarget.checked })}
          />
          Hide while panning
        </label>
      </div>
    </div>
  );
}
