import type { ReviewObject } from "@parfocal/api-client";
import type { Format } from "@parfocal/ui/lib/format";
import { defaultFormat } from "../../format.ts";
import { countWord } from "../review/decision-style.ts";
import type { Answer } from "../review/review-state.ts";

export type TableRowItem = {
  object: string;
  kind: string;
  score: number | null;
  size: string;
  answer: Answer | undefined;
  added: boolean;
  note: string;
  preset: string;
};

export type TableColumn = "id" | "kind" | "score" | "size" | "decision" | "preset" | "note";

export const columnTitle: Record<TableColumn, string> = {
  id: "ID",
  kind: "Kind",
  score: "Score",
  size: "Size",
  decision: "Your decision",
  preset: "Preset",
  note: "Note",
};

export function tableColumns(options: { showScore: boolean; presetUsed: boolean }): TableColumn[] {
  const all: TableColumn[] = ["id", "kind", "score", "size", "decision", "preset", "note"];
  return all.filter(
    (column) =>
      (column !== "score" || options.showScore) && (column !== "preset" || options.presetUsed),
  );
}

export function decisionWord(row: TableRowItem): string {
  if (row.added) return "Added";
  return row.answer ? countWord[row.answer.value] : "open";
}

export function tableRows(
  objects: ReviewObject[],
  added: { object: string; size: string; note: string | null }[],
  answer: (object: string) => Answer | undefined,
  format: Format = defaultFormat,
  presetName = "",
): TableRowItem[] {
  const regions = objects.filter((item) => item.kind === "region");
  const cells = objects
    .filter((item) => item.kind === "cell")
    .filter((item) => {
      const decided = answer(item.object);
      return decided?.note || decided?.value === "disagree";
    });
  const noteOf = (decided: Answer | undefined) =>
    (decided?.reasons[0] ?? decided?.note ?? "").toLowerCase();
  const presetOf = (decided: Answer | undefined) => (decided ? presetName : "");
  return [
    ...regions.map((item) => ({
      object: item.object,
      kind: "Tumor region",
      score: item.score,
      size: item.size_mm == null ? "" : format.size(item.size_mm),
      answer: answer(item.object),
      added: false,
      note: noteOf(answer(item.object)),
      preset: presetOf(answer(item.object)),
    })),
    ...added.map((item) => ({
      object: item.object,
      kind: "Tumor region",
      score: null,
      size: item.size,
      answer: undefined,
      added: true,
      note: (item.note ?? "").replace(/^./, (first) => first.toLowerCase()),
      preset: "",
    })),
    ...cells.map((item) => ({
      object: item.object,
      kind: `${item.class_name} cell`,
      score: item.score,
      size: "",
      answer: answer(item.object),
      added: false,
      note: noteOf(answer(item.object)),
      preset: presetOf(answer(item.object)),
    })),
  ];
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function cellOf(
  row: TableRowItem,
  column: TableColumn,
  pathOf: (object: string) => string,
): string {
  switch (column) {
    case "id":
      return pathOf(row.object);
    case "kind":
      return row.kind;
    case "score":
      return row.score === null ? "" : row.score.toFixed(2);
    case "size":
      return row.size;
    case "decision":
      return decisionWord(row);
    case "preset":
      return row.preset;
    case "note":
      return row.note;
  }
}

export function tableCsv(
  rows: TableRowItem[],
  columns: TableColumn[],
  pathOf: (object: string) => string,
): string {
  const lines = [
    columns.map((column) => columnTitle[column]),
    ...rows.map((row) => columns.map((column) => cellOf(row, column, pathOf))),
  ];
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\n")}\n`;
}
