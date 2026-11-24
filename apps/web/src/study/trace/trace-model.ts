export type FrameNode =
  | string
  | [tag: string, attrs: Record<string, string>, children: FrameNode[]];

export type Frame = {
  body: FrameNode;
  rootAttrs: Record<string, string>;
  scrollX: number;
  scrollY: number;
};

export type TraceEvent =
  | { t: number; k: "load"; path: string; reload: boolean; w: number; h: number; head: string[] }
  | { t: number; k: "route"; path: string }
  | { t: number; k: "move"; x: number; y: number }
  | {
      t: number;
      k: "click";
      x: number;
      y: number;
      target: string;
      interactive: boolean;
      held?: number;
      dragged?: boolean;
    }
  | { t: number; k: "key"; key: string }
  | { t: number; k: "mutation" }
  | { t: number; k: "frame"; frame: Frame }
  | { t: number; k: "task"; taskId: string; edge: "start" | "end"; outcome?: string }
  | ({ t: number; k: "camera" } & CameraSample);

export type CameraSample = {
  slide: string;
  x: number;
  y: number;
  zoom: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
};

export const sameCamera = (a: CameraSample | undefined, b: CameraSample): boolean =>
  a !== undefined &&
  a.slide === b.slide &&
  a.x === b.x &&
  a.y === b.y &&
  a.zoom === b.zoom &&
  a.vw === b.vw &&
  a.vh === b.vh;

export function cameraAt(events: TraceEvent[], time: number): CameraSample | undefined {
  const limit = startOf(events) + time;
  let found: CameraSample | undefined;
  for (const event of events) {
    if (event.t > limit) break;
    if (event.k === "load") found = undefined;
    if (event.k === "camera") {
      const { slide, x, y, zoom, w, h, vw, vh } = event;
      found = { slide, x, y, zoom, w, h, vw, vh };
    }
  }
  return found;
}

export type ViewBox = { left: number; top: number; width: number; height: number };

export function viewBoxOf(camera: CameraSample): ViewBox {
  const scale = 2 ** camera.zoom;
  const width = camera.vw / scale;
  const height = camera.vh / scale;
  return { left: camera.x - width / 2, top: camera.y - height / 2, width, height };
}

export type TraceBatch = { sessionId: string; index: number; events: TraceEvent[] };

export const maskGlyph = "•";

export const maskText = (text: string): string => text.replace(/\S/g, maskGlyph);

export function loggedKey(key: string, inTextField: boolean): string {
  if (key.length > 1) return key;
  if (inTextField) return maskGlyph;
  return key === " " ? "Space" : key;
}

export function mergeBatches(batches: TraceBatch[]): TraceEvent[] {
  return [...batches]
    .sort((a, b) => a.index - b.index)
    .flatMap((batch) => batch.events)
    .sort((a, b) => a.t - b.t);
}

export const startOf = (events: TraceEvent[]): number => events[0]?.t ?? 0;

export const durationOf = (events: TraceEvent[]): number => {
  const last = events[events.length - 1];
  return last === undefined ? 0 : Math.max(0, last.t - startOf(events));
};

export type TaskSpan = { taskId: string; from: number; to: number; outcome: string | undefined };

export function taskSpans(events: TraceEvent[]): TaskSpan[] {
  const origin = startOf(events);
  const total = durationOf(events);
  const spans: TaskSpan[] = [];
  const open = new Map<string, TaskSpan>();
  for (const event of events) {
    if (event.k !== "task") continue;
    const at = event.t - origin;
    if (event.edge === "start") {
      const span: TaskSpan = { taskId: event.taskId, from: at, to: total, outcome: undefined };
      open.set(event.taskId, span);
      spans.push(span);
    } else {
      const span = open.get(event.taskId);
      if (span !== undefined) {
        span.to = at;
        span.outcome = event.outcome;
        open.delete(event.taskId);
      }
    }
  }
  return spans;
}

export const deadClickWindowMs = 800;

const reactedBetween = (events: TraceEvent[], from: number, to: number): boolean =>
  events.some(
    (event) =>
      event.t >= from &&
      event.t <= to &&
      (event.k === "mutation" || event.k === "load" || event.k === "route"),
  );

export function deadClicks(events: TraceEvent[], windowMs = deadClickWindowMs): number[] {
  const origin = startOf(events);
  const lastAt = events[events.length - 1]?.t ?? 0;
  return events.flatMap((event) => {
    if (event.k !== "click" || event.interactive || event.dragged === true) return [];
    if (lastAt - event.t < windowMs) return [];
    const reacted = reactedBetween(events, event.t - (event.held ?? 0), event.t + windowMs);
    return reacted ? [] : [event.t - origin];
  });
}

export function silentControlClicks(events: TraceEvent[], windowMs = deadClickWindowMs): number[] {
  const origin = startOf(events);
  const lastAt = events[events.length - 1]?.t ?? 0;
  return events.flatMap((event) => {
    if (event.k !== "click" || !event.interactive) return [];
    if (lastAt - event.t < windowMs) return [];
    return reactedBetween(events, event.t, event.t + windowMs) ? [] : [event.t - origin];
  });
}

export function reloads(events: TraceEvent[]): number[] {
  const origin = startOf(events);
  return events.flatMap((event) => (event.k === "load" && event.reload ? [event.t - origin] : []));
}

export type Point = { x: number; y: number };

export function cursorAt(events: TraceEvent[], time: number): Point | undefined {
  const limit = startOf(events) + time;
  let found: Point | undefined;
  for (const event of events) {
    if (event.t > limit) break;
    if (event.k === "move" || event.k === "click") found = { x: event.x, y: event.y };
  }
  return found;
}

export function recentClick(events: TraceEvent[], time: number, windowMs = 600): Point | undefined {
  const limit = startOf(events) + time;
  let found: Point | undefined;
  for (const event of events) {
    if (event.t > limit) break;
    if (event.k === "click" && limit - event.t <= windowMs) found = { x: event.x, y: event.y };
  }
  return found;
}

export type ScreenAt = {
  load: Extract<TraceEvent, { k: "load" }> | undefined;
  path: string;
  frame: Frame | undefined;
};

export function screenAt(events: TraceEvent[], time: number): ScreenAt {
  const limit = startOf(events) + time;
  let load: ScreenAt["load"];
  let path = "";
  let frame: Frame | undefined;
  for (const event of events) {
    if (event.t > limit) break;
    if (event.k === "load") {
      load = event;
      path = event.path;
      frame = undefined;
    } else if (event.k === "route") {
      path = event.path;
    } else if (event.k === "frame") {
      frame = event.frame;
    }
  }
  return { load, path, frame };
}

export type Wireframe = {
  path: string;
  width: number;
  height: number;
  marks: { x: number; y: number; target: string }[];
};

export function wireframeAt(events: TraceEvent[], time: number): Wireframe {
  const limit = startOf(events) + time;
  let wireframe: Wireframe = { path: "", width: 1280, height: 800, marks: [] };
  for (const event of events) {
    if (event.t > limit) break;
    if (event.k === "load") {
      wireframe = { path: event.path, width: event.w, height: event.h, marks: [] };
    } else if (event.k === "route") {
      wireframe = { ...wireframe, path: event.path, marks: [] };
    } else if (event.k === "click") {
      wireframe = {
        ...wireframe,
        marks: [...wireframe.marks, { x: event.x, y: event.y, target: event.target }].slice(-30),
      };
    }
  }
  return wireframe;
}

export const hasFrames = (events: TraceEvent[]): boolean =>
  events.some((event) => event.k === "frame");

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const voidTags = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr"]);

export function frameHtml(node: FrameNode): string {
  if (typeof node === "string") return escapeHtml(node);
  const [tag, attrs, children] = node;
  const attributes = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  if (voidTags.has(tag)) return `<${tag}${attributes}>`;
  return `<${tag}${attributes}>${children.map(frameHtml).join("")}</${tag}>`;
}

export function documentHtml(screen: ScreenAt, origin: string): string {
  const head = screen.load?.head.join("") ?? "";
  const body = screen.frame === undefined ? "<body></body>" : frameHtml(screen.frame.body);
  const rootAttrs = Object.entries(screen.frame?.rootAttrs ?? {})
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  return `<!doctype html><html${rootAttrs}><head><base href="${escapeHtml(origin)}/">${head}</head>${body}</html>`;
}
