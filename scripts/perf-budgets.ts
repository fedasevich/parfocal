import { readFile } from "node:fs/promises";

export const regressionRule = 1.2;
export const maxHeadroom = 3;

export type BudgetKind = "bytes" | "count" | "ms" | "manual";

export interface Budget {
  readonly id: string;
  readonly measures: string;
  readonly kind: BudgetKind;
  readonly unit: string;
  readonly baseline: number | null;
  readonly limit: number | null;
  readonly headroom?: number;
  readonly headroomReason?: string;
  readonly rttMs?: number;
  readonly environment: string;
  readonly check: string;
  readonly adr: string;
  readonly result: string | null;
  readonly todo?: string;
}

export interface BudgetFile {
  readonly rule: string;
  readonly budgets: readonly Budget[];
}

export const budgetsUrl = new URL("../perf-budgets.json", import.meta.url);

export async function loadBudgets(): Promise<BudgetFile> {
  return JSON.parse(await readFile(budgetsUrl, "utf8")) as BudgetFile;
}

export async function budget(id: string): Promise<Budget> {
  const found = (await loadBudgets()).budgets.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`perf-budgets.json has no budget ${id}`);
  return found;
}

export function exceeds(entry: Budget, measured: number): string | null {
  if (entry.limit === null) return `${entry.id} has no limit, it is a ${entry.kind} budget`;
  if (measured <= entry.limit) return null;
  return `${entry.id} measured ${Math.round(measured)} ${entry.unit}, over the limit ${entry.limit} (baseline ${entry.baseline}, ${entry.adr})`;
}

export async function checkBudget(
  id: string,
  measured: number,
  context: { readonly rttMs?: number } = {},
): Promise<void> {
  const entry = await budget(id);
  if (entry.rttMs !== undefined && context.rttMs !== undefined && entry.rttMs !== context.rttMs) {
    return;
  }
  const problem = exceeds(entry, measured);
  if (problem !== null) throw new Error(problem);
}
