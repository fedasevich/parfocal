import {
  type InputTrace,
  type TraceDevice,
  type TraceEvent,
  type TraceGesture,
  type TraceGestureName,
  traceGestureNames,
} from "../../test/input/trace-format.ts";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`The recorder page has no #${id}`);
  return element as T;
}

const pad = byId<HTMLDivElement>("pad");
const recordButton = byId<HTMLButtonElement>("record");
const stopButton = byId<HTMLButtonElement>("stop");
const saveButton = byId<HTMLButtonElement>("save");
const status = byId<HTMLSpanElement>("status");
const log = byId<HTMLDivElement>("log");
const labelInput = byId<HTMLInputElement>("label");
const gestureBox = byId<HTMLFieldSetElement>("gestures");

const recorded: TraceGesture[] = [];
let gesture: TraceGestureName = "scroll-down";
let events: TraceEvent[] | null = null;
let startedAt = 0;

for (const name of traceGestureNames) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = name;
  button.setAttribute("aria-pressed", String(name === gesture));
  button.addEventListener("click", () => {
    gesture = name;
    for (const other of gestureBox.querySelectorAll("button")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
  gestureBox.append(button);
}

function device(): TraceDevice {
  const checked = document.querySelector<HTMLInputElement>('input[name="device"]:checked');
  return checked?.value === "trackpad" ? "trackpad" : "mouse";
}

function osName(): string {
  const agent = navigator.userAgent;
  if (/Mac OS X/.test(agent)) return "macOS";
  if (/Windows/.test(agent)) return "Windows";
  if (/Linux/.test(agent)) return "Linux";
  return "unknown";
}

function browserName(): string {
  const agent = navigator.userAgent;
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/Edg\//.test(agent)) return "Edge";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return "unknown";
}

function time(event: Event): number {
  if (events !== null && events.length === 0) startedAt = event.timeStamp;
  return Math.round((event.timeStamp - startedAt) * 10) / 10;
}

function modifiers(event: MouseEvent) {
  return {
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

function push(event: TraceEvent) {
  events?.push(event);
  status.textContent = `Recording ${gesture}: ${events?.length ?? 0} events`;
}

pad.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (events === null) return;
    push({
      type: "wheel",
      t: time(event),
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ...modifiers(event),
    });
  },
  { passive: false },
);

for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) {
  pad.addEventListener(type, (event) => {
    if (type === "pointerdown") {
      try {
        pad.setPointerCapture(event.pointerId);
      } catch {
        status.textContent = "Pointer capture refused";
      }
    }
    if (events === null) return;
    if (type === "pointermove" && event.buttons === 0) return;
    push({
      type,
      t: time(event),
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      buttons: event.buttons,
      ...modifiers(event),
    });
  });
}

pad.addEventListener("dblclick", (event) => {
  event.preventDefault();
  if (events === null) return;
  push({
    type: "dblclick",
    t: time(event),
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    ...modifiers(event),
  });
});

for (const type of ["mousedown", "auxclick", "contextmenu"]) {
  pad.addEventListener(type, (event) => event.preventDefault());
}

function trace(): InputTrace {
  const box = pad.getBoundingClientRect();
  const origin = { os: osName(), browser: browserName() };
  return {
    schema: 1,
    origin: "recorded",
    device: device(),
    label: labelInput.value.trim() || `${device()} in ${origin.browser} on ${origin.os}`,
    ...origin,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { left: box.left, top: box.top, width: box.width, height: box.height },
    userAgent: navigator.userAgent,
    gestures: recorded,
  };
}

function render() {
  log.textContent = recorded
    .map((entry) => `${entry.gesture}: ${entry.events.length} events`)
    .join("\n");
  saveButton.disabled = recorded.length === 0;
}

recordButton.addEventListener("click", () => {
  events = [];
  pad.classList.add("armed");
  recordButton.disabled = true;
  stopButton.disabled = false;
  status.textContent = `Recording ${gesture}: 0 events`;
});

stopButton.addEventListener("click", () => {
  if (events !== null && events.length > 0) recorded.push({ gesture, events });
  events = null;
  pad.classList.remove("armed");
  recordButton.disabled = false;
  stopButton.disabled = true;
  status.textContent = "Idle";
  render();
});

saveButton.addEventListener("click", () => {
  const body = trace();
  const slug = `${body.device}-${body.os}-${body.browser}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const blob = new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slug}.recorded.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
