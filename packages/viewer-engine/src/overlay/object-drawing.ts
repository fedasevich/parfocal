import { createOverlayController, type OverlayHost } from "./controller.ts";
import {
  clampOpacity,
  colourModes,
  confidenceTint,
  type DrawnObject,
  type DrawnOverlays,
  type DrawSettings,
  defaultDrawSettings,
  drawModes,
  drawObjectOverlays,
  drawWidths,
} from "./draw-style.ts";
import type { ClassName } from "./outline-style.ts";
import type { Rgba, VectorKind } from "./types.ts";

export interface DisplayDrawChoices {
  readonly draw?: string;
  readonly width?: string;
  readonly opacity?: number;
  readonly colorBy?: string;
  readonly cutoff?: number;
  readonly confidence?: string;
}

export interface ObjectDrawing {
  readonly setObjects: (objects: readonly DrawnObject[]) => void;
  readonly setChoices: (choices: DisplayDrawChoices) => void;
  readonly setHiddenClasses: (hidden: ReadonlySet<ClassName>) => void;
  readonly setCurrent: (id: string | null) => void;
  readonly settings: () => DrawSettings;
  readonly result: () => DrawnOverlays | null;
  readonly clear: () => void;
}

export interface ObjectDrawingOptions {
  readonly id: string;
  readonly host: OverlayHost;
  readonly kind?: VectorKind;
}

export function drawSettingsFromChoices(
  choices: DisplayDrawChoices,
  base: DrawSettings = defaultDrawSettings,
): DrawSettings {
  const draw = drawModes.find((mode) => mode === choices.draw);
  const width = drawWidths.find((px) => String(px) === choices.width);
  const colourBy = colourModes.find((mode) => mode === choices.colorBy);
  return {
    ...base,
    draw: draw ?? base.draw,
    widthPx: width ?? base.widthPx,
    opacity: choices.opacity === undefined ? base.opacity : clampOpacity(choices.opacity),
    colourBy: colourBy ?? base.colourBy,
    cutoff: choices.cutoff === undefined ? base.cutoff : Math.min(1, Math.max(0, choices.cutoff)),
  };
}

export function createObjectDrawing(options: ObjectDrawingOptions): ObjectDrawing {
  const controller = createOverlayController(options.host);
  let objects: readonly DrawnObject[] = [];
  let choices: DisplayDrawChoices = {};
  let hidden: ReadonlySet<ClassName> = new Set();
  let currentId: string | null = null;
  let last: DrawnOverlays | null = null;

  const tintFor = (id: string): Rgba | null => {
    if (choices.confidence !== "color") return null;
    const object = objects.find((item) => item.id === id);
    return object ? confidenceTint(object.score) : null;
  };

  const settings = (): DrawSettings => ({
    ...drawSettingsFromChoices(choices),
    hiddenClasses: hidden,
  });

  const apply = () => {
    const drawn = drawObjectOverlays({
      id: options.id,
      objects,
      settings: settings(),
      current: currentId === null ? null : { id: currentId, tint: tintFor(currentId) },
      ...(options.kind ? { kind: options.kind } : {}),
    });
    const keep = new Set(drawn.overlays.map((overlay) => overlay.id));
    for (const stale of controller.list()) if (!keep.has(stale.id)) controller.remove(stale.id);
    for (const overlay of drawn.overlays) controller.set(overlay);
    last = drawn;
  };

  return {
    setObjects: (next) => {
      objects = next;
      apply();
    },
    setChoices: (next) => {
      choices = next;
      apply();
    },
    setHiddenClasses: (next) => {
      hidden = next;
      apply();
    },
    setCurrent: (id) => {
      currentId = id;
      apply();
    },
    settings,
    result: () => last,
    clear: () => {
      controller.clear();
      last = null;
    },
  };
}
