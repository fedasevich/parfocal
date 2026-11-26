import type { ParsedResults, PreviewShape } from "./geojson-placement.ts";

export type Delimiter = "," | "\t" | ";";

const delimiters: readonly Delimiter[] = [",", "\t", ";"];

const xNames = ["x", "centroid_x", "centroid x", "centroid x µm", "cx", "x_px", "pos_x"];
const yNames = ["y", "centroid_y", "centroid y", "centroid y µm", "cy", "y_px", "pos_y"];

const countOf = (line: string, delimiter: Delimiter) => splitRow(line, delimiter).length - 1;

export const delimiterOf = (headerLine: string): Delimiter => {
  let best: Delimiter = headerLine.includes("\t") ? "\t" : ",";
  let most = countOf(headerLine, best);
  for (const delimiter of delimiters) {
    const count = countOf(headerLine, delimiter);
    if (count > most) {
      best = delimiter;
      most = count;
    }
  }
  return best;
};

export const splitRow = (line: string, delimiter: Delimiter): string[] => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    const char = line.charAt(at);
    if (quoted) {
      if (char === '"' && line.charAt(at + 1) === '"') {
        cell += '"';
        at += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
};

const columnOf = (header: readonly string[], names: readonly string[]) => {
  const lowered = header.map((name) => name.trim().toLowerCase());
  for (const name of names) {
    const at = lowered.indexOf(name);
    if (at >= 0) return at;
  }
  return -1;
};

export type TableColumns = { delimiter: Delimiter; x: number; y: number };

export const tableColumnsOf = (headerLine: string): TableColumns | null => {
  const delimiter = delimiterOf(headerLine);
  const header = splitRow(headerLine, delimiter);
  const x = columnOf(header, xNames);
  const y = columnOf(header, yNames);
  return x < 0 || y < 0 ? null : { delimiter, x, y };
};

const numberIn = (cells: readonly string[], at: number) => {
  const text = cells[at]?.trim() ?? "";
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

export const tablePreview = (text: string): ParsedResults | null => {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const columns = tableColumnsOf(lines[0] ?? "");
  if (columns === null) return null;
  const shapes: PreviewShape[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const cells = splitRow(line, columns.delimiter);
    const x = numberIn(cells, columns.x);
    const y = numberIn(cells, columns.y);
    if (x === null || y === null) continue;
    shapes.push({ id: shapes.length, kind: "point", x, y });
  }
  return shapes.length === 0 ? null : { shapes, objects: shapes.length };
};
