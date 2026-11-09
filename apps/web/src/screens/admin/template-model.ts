import type {
  Presets,
  StudyTemplateDraft,
  StudyTemplateSummary,
  TaskScope,
} from "@parfocal/api-client";
import {
  defaultFormat,
  type EditorBlock,
  type FormatSettings,
  toApiBlocks,
  toEditorBlocks,
} from "@parfocal/ui/lib/report-editor-model";

export type StudyKind = StudyTemplateSummary["study_kind"];

export const studyKinds: { value: StudyKind; label: string }[] = [
  { value: "regions-and-cells", label: "Regions and cells" },
  { value: "regions", label: "Regions" },
  { value: "outlines", label: "Outlines" },
  { value: "cells", label: "Cells" },
  { value: "reviewers-first", label: "Reviewers first" },
  { value: "other", label: "Other" },
];

export const kindLabel = (kind: StudyKind) =>
  studyKinds.find((item) => item.value === kind)?.label ?? kind;

export type TemplateDraft = {
  name: string;
  kind: StudyKind;
  from: string | null;
  paper: "a4" | "letter";
};

export type TemplateSource = StudyTemplateSummary | TemplateDraft;

export const isDraft = (source: TemplateSource): source is TemplateDraft => !("id" in source);

export const scopeText: Record<string, string> = {
  "all-regions": "tumor regions",
  "random-cells": "a random sample of cells",
  "cells-below-score": "cells the model was least sure about",
  "inside-rois": "only inside ROIs",
  "unsure-zones": "unsure zones",
  "whole-slide": "the whole slide",
};

export const scopeChoices: { kind: TaskScope; label: string }[] = [
  { kind: "all-regions", label: "Tumor regions" },
  { kind: "random-cells", label: "A random sample of cells" },
  { kind: "cells-below-score", label: "Cells the model was least sure about" },
  { kind: "inside-rois", label: "Only inside ROIs" },
  { kind: "unsure-zones", label: "Unsure zones" },
];

export const splitText = {
  everyone: "everyone reviews all",
  even: "split evenly",
  chosen: "chosen per slide",
};

export const startText = { guided: "guided review", viewer: "the full viewer" };

export const presetsText = (template: Pick<StudyTemplateSummary, "presets">) => {
  const presets = template.presets;
  const scope = scopeText[presets.objects_to_check.kind] ?? presets.objects_to_check.kind;
  const read = presets.first_read
    ? "a first read without the AI"
    : (presets.blinding ?? true)
      ? "blind"
      : "open";
  const start = presets.start_mode === "viewer" ? startText.viewer : startText.guided;
  return `${scope[0]?.toUpperCase() ?? ""}${scope.slice(1)}, ${read}, ${start}, ${splitText[presets.split ?? "everyone"]}`;
};

export function scopeFor(kind: TaskScope, was: Presets["objects_to_check"]) {
  if (was.kind === kind) return was;
  if (kind === "random-cells") return { kind, count: 100 };
  if (kind === "cells-below-score") return { kind, score: 0.5 };
  return { kind };
}

export const emptyPresets: Presets = { objects_to_check: { kind: "all-regions" } };

export function formatOf(source: StudyTemplateSummary | undefined, paper?: "a4" | "letter") {
  const stored = source?.format ?? {};
  const format: FormatSettings = {
    ...defaultFormat,
    ...(stored as Partial<FormatSettings>),
  };
  return paper ? { ...format, paper } : format;
}

export function startingBlocks(
  source: TemplateSource,
  library: StudyTemplateSummary[],
): EditorBlock[] {
  const base = isDraft(source) ? library.find((item) => item.id === source.from) : source;
  return base ? toEditorBlocks(base.blocks) : [];
}

export function templateBody(input: {
  name: string;
  kind: StudyKind;
  blocks: EditorBlock[];
  format: FormatSettings;
  presets: Presets;
}): StudyTemplateDraft {
  return {
    name: input.name.trim() || "Untitled template",
    study_kind: input.kind,
    blocks: toApiBlocks(input.blocks) as unknown as StudyTemplateDraft["blocks"],
    format: input.format,
    presets: input.presets,
  };
}

export function nameProblem(name: string, library: readonly { name: string }[], except?: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Give the template a name.";
  if (trimmed.length < 2) return "Use at least 2 characters.";
  const taken = library.find(
    (item) => item.name.toLowerCase() === trimmed.toLowerCase() && item.name !== except,
  );
  return taken ? `A template called ${taken.name} already exists.` : undefined;
}

export function editorHead(source: TemplateSource | undefined) {
  if (source === undefined) return { title: "Untitled template", sub: "" };
  if (isDraft(source)) {
    return { title: source.name, sub: `${kindLabel(source.kind)} · a new template` };
  }
  return source.built_in === null
    ? { title: source.name, sub: `${kindLabel(source.study_kind)} · editing v${source.version}` }
    : {
        title: `${source.name} copy`,
        sub: `${kindLabel(source.study_kind)} · a copy of ${source.name}, which comes with Parfocal`,
      };
}

export function saveHint(source: TemplateSource) {
  if (isDraft(source)) {
    return "Saving adds it to the library as v1. Researchers can pick it in a new review task.";
  }
  if (source.built_in === null) {
    const used = source.task_count;
    return used > 0
      ? `Saving makes v${source.version + 1}. ${used} task${used === 1 ? "" : "s"} on v${source.version} keep${used === 1 ? "s" : ""} it.`
      : `Saving makes v${source.version + 1}. A task keeps the version it was created with.`;
  }
  return "Saving adds the copy to the library as v1.";
}

export function problemTitle(body: unknown): string {
  const title = (body as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "That did not save. Try again.";
}

export function keyedBlocks<T extends { kind: string; title: string }>(blocks: readonly T[]) {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const base = `${block.kind}:${block.title}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { block, key: `${base}:${count}` };
  });
}
