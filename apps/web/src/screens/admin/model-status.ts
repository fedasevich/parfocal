import type { AiModel } from "@parfocal/api-client";
import type { StatusTone } from "@parfocal/ui/components/tag";

export function modelStatus(model: AiModel): { text: string; tone: StatusTone } {
  if (model.status === "answering") {
    return { text: `Answering · ${model.latency_ms ?? 0} ms`, tone: "ok" };
  }
  if (model.status === "offline") return { text: "Offline", tone: "bad" };
  if (model.status === "imports-only") return { text: "Imports only", tone: "accent" };
  if (model.status === "hidden") return { text: "Hidden", tone: "neutral" };
  return { text: "Active", tone: "ok" };
}
