import {
  type SetRef,
  type TaskScope,
  useListProjectResultSets,
  useListSlideThreads,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { FactList } from "@parfocal/ui/components/inspector";
import { Keycap } from "@parfocal/ui/components/keycap";
import { ProgressRing } from "@parfocal/ui/components/progress-meter";
import { ObjectIdTag, ResultSetTag } from "@parfocal/ui/components/tag";
import type { ComponentProps, ReactNode } from "react";
import { okData } from "../placeholder.tsx";
import type { SlideProgress } from "../slide-progress.ts";
import { lookUrl } from "../thumbnails.ts";

export const scopeWords: Record<TaskScope, string> = {
  "all-regions": "Tumor regions: all",
  "random-cells": "A random sample of cells",
  "cells-below-score": "Cells the model was least sure about",
  "inside-rois": "Only inside ROIs",
  "unsure-zones": "Unsure zones only",
};

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <span className="text-caption font-semibold text-fg-dim">{children}</span>
);

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.25 rounded-lg border border-line bg-chrome-2 px-3 py-2.5 text-body-sm text-fg-dim">
      <Icon name="info" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function SlideThumb({
  className = "",
  style,
}: {
  className?: string;
  style?: ComponentProps<"i">["style"];
}) {
  return (
    <i
      aria-hidden="true"
      className={`block shrink-0 rounded-md border border-line bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url(${lookUrl("overview")})`, ...style }}
    />
  );
}

const firstAndLast = (name: string) => {
  const words = name.split(" ");
  return words.length > 1 ? `${words[0]} ${words.at(-1)}` : name;
};

export function useSetLook(projectId: string | undefined) {
  const sets =
    okData(
      useListProjectResultSets(projectId ?? "", { query: { enabled: Boolean(projectId) } }).data,
    ) ?? [];
  return (set: Pick<SetRef, "id" | "name">) => {
    const known = sets.find((candidate) => candidate.id === set.id);
    if (known) {
      return {
        label: `${known.name.split(" ")[0]} ${known.model_version ?? ""}`.trim(),
        source: known.source === "run" ? ("run" as const) : ("imported" as const),
      };
    }
    return {
      label: firstAndLast(set.name),
      source: set.name.startsWith("Reviewed") ? ("reviewed" as const) : ("imported" as const),
    };
  };
}

export function SetChip({
  label,
  source,
}: {
  label: string;
  source: "imported" | "run" | "reviewed";
}) {
  return <ResultSetTag source={source}>{label}</ResultSetTag>;
}

export function ProgressSummary({ progress }: { progress: SlideProgress }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg bg-chrome-2 px-3 py-2.5">
      <ProgressRing split={progress} size={44} />
      <div>
        <b className="block text-body font-semibold text-fg">
          {progress.decided
            ? `${progress.decided} of ${progress.total} objects decided`
            : `${progress.total} objects, none decided yet`}
        </b>
        <small className="mt-0.5 block text-caption text-fg-dim">
          {progress.decided
            ? `${progress.agree} agree, ${progress.disagree} disagree, ${progress.unsure} not sure, ${progress.open} open`
            : "Your progress on this slide"}
        </small>
      </div>
    </div>
  );
}

export function useOpenThreads(slideId: string | undefined) {
  const threads = useListSlideThreads(slideId ?? "", {
    query: { enabled: slideId !== undefined },
  }).data?.data;
  return (threads ?? []).filter((thread) => !thread.resolved);
}

export function ThreadsValue({ anchors }: { anchors: string[] }) {
  if (anchors.length === 0) return <>None</>;
  return (
    <>
      {anchors.length} {anchors.length === 1 ? "thread" : "threads"}
      <span className="mt-1 flex flex-wrap gap-1">
        {anchors.map((anchor) => (
          <ObjectIdTag key={anchor}>{anchor}</ObjectIdTag>
        ))}
      </span>
    </>
  );
}

type PreviewProps = {
  title: string;
  subtitle?: string | undefined;
  progress?: SlideProgress | undefined;
  facts: ComponentProps<typeof FactList>["rows"];
  main: { label: string; run: () => void };
  full?: (() => void) | undefined;
  onClose: () => void;
};

export function PreviewPanel({
  title,
  subtitle,
  progress,
  facts,
  main,
  full,
  onClose,
}: PreviewProps) {
  return (
    <aside
      aria-label={`Preview of ${title}`}
      className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-chrome px-4 pt-3.5 pb-4"
    >
      <div className="-mb-1.5 flex items-center justify-between">
        <SectionLabel>Preview</SectionLabel>
        <Button variant="ghost" size="icon-sm" aria-label="Close the preview" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <div
        aria-hidden="true"
        className="h-35 rounded-[10px] bg-[#f1eef2] bg-cover bg-[center_40%] bg-no-repeat"
        style={{ backgroundImage: `url(${lookUrl("overview")})` }}
      />
      <div>
        <h3 className="m-0 text-[18px] font-semibold text-fg">{title}</h3>
        {subtitle ? (
          <small className="mt-0.5 block text-caption text-fg-dim">{subtitle}</small>
        ) : null}
      </div>
      {progress ? <ProgressSummary progress={progress} /> : null}
      <FactList tight rows={facts} className="grid-cols-[124px_minmax(0,1fr)] gap-x-3 gap-y-2" />
      <div className="grid gap-2">
        <Button variant="primary" block onClick={main.run}>
          {main.label} <Keycap keys="↵" />
        </Button>
        {full ? (
          <Button block onClick={full}>
            Open in the full viewer
          </Button>
        ) : null}
      </div>
      <span className="flex items-center gap-1.5 text-caption text-fg-faint">
        <Keycap keys="↑" />
        <Keycap keys="↓" /> next row <Keycap keys="Esc" className="ml-2" /> close
      </span>
    </aside>
  );
}
