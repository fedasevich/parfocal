export const chromeInternalSources: readonly string[] = [
  "base/allocator/partition_alloc_support.cc",
  "third_party/blink/renderer/controller/memory_usage_monitor.cc",
];

export interface MainThreadTask {
  readonly ms: number;
  readonly source: string;
}

export interface MainThreadSummary {
  readonly totalMs: number;
  readonly chromeInternalMs: number;
  readonly pageMs: number;
  readonly longest: readonly MainThreadTask[];
}

interface TraceEvent {
  readonly ph?: string;
  readonly name?: string;
  readonly pid?: number;
  readonly tid?: number;
  readonly dur?: number;
  readonly args?: { readonly name?: string; readonly src_file?: string };
}

const runTask = "ThreadControllerImpl::RunTask";
const rendererMain = "CrRendererMain";

export const traceCategories: readonly string[] = ["toplevel"];

export function summarizeMainThread(trace: Buffer): MainThreadSummary {
  const parsed = JSON.parse(trace.toString("utf8")) as
    | { traceEvents?: TraceEvent[] }
    | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const names = new Map<string, string>();
  for (const event of events) {
    if (event.ph === "M" && event.name === "thread_name" && event.args?.name !== undefined) {
      names.set(`${event.pid}:${event.tid}`, event.args.name);
    }
  }
  const tasks: MainThreadTask[] = [];
  for (const event of events) {
    if (event.ph !== "X" || event.name !== runTask || event.dur === undefined) continue;
    if (names.get(`${event.pid}:${event.tid}`) !== rendererMain) continue;
    tasks.push({ ms: event.dur / 1000, source: event.args?.src_file ?? "unknown" });
  }
  const sum = (selected: readonly MainThreadTask[]) =>
    selected.reduce((total, task) => total + task.ms, 0);
  const internal = tasks.filter((task) => chromeInternalSources.includes(task.source));
  const page = tasks.filter((task) => !chromeInternalSources.includes(task.source));
  return {
    totalMs: sum(tasks),
    chromeInternalMs: sum(internal),
    pageMs: sum(page),
    longest: [...tasks].sort((a, b) => b.ms - a.ms).slice(0, 3),
  };
}
