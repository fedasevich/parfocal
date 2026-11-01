import type { AiModel } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { StatusTag, type StatusTone } from "@parfocal/ui/components/tag";
import { now } from "../../clock.ts";
import { daysBetween } from "../format.ts";

export const tb = (value: number) => `${+value.toFixed(1)} TB`;

export function lastActive(at: string | null): string {
  if (at === null) return "Not yet";
  const when = new Date(at);
  const today = now();
  const minutes = Math.round((today.getTime() - when.getTime()) / 60000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes} min ago`;
  const days = daysBetween(when, today);
  if (days === 0) return `${Math.round(minutes / 60)} h ago`;
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function modelStatus(model: AiModel): { text: string; tone: StatusTone } {
  if (model.status === "answering") {
    return { text: `Answering · ${model.latency_ms ?? 0} ms`, tone: "ok" };
  }
  if (model.status === "imports-only") return { text: "Imports only", tone: "accent" };
  if (model.status === "hidden") return { text: "Hidden", tone: "neutral" };
  return { text: "Active", tone: "ok" };
}

export function ModelStatus({ model }: { model: AiModel }) {
  const status = modelStatus(model);
  return <StatusTag tone={status.tone}>{status.text}</StatusTag>;
}

export function MoreButton({ label = "More" }: { label?: string }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
      <Icon name="more" />
    </Button>
  );
}

export function InfoLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-body-sm text-fg-dim">
      <Icon name="info" />
      <span className="flex items-center gap-2">{children}</span>
    </div>
  );
}

export function TextLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline"
    >
      {children}
    </button>
  );
}

export const tableClass =
  "[&_td]:h-11.5 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0";

export type Notify = (message: React.ReactNode, undo?: () => void) => void;
