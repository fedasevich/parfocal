import type { AssignedTask, SlideRow } from "@parfocal/api-client";
import { destinations } from "../../shell/destinations.ts";

export type ListMove = { kind: "select"; sel: string } | { kind: "clear" } | { kind: "open" };

export type ListKey = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

export const onListRow = (target: EventTarget | null) =>
  Boolean((target as HTMLElement | null)?.closest?.("[role='option'], [data-list-row]"));

const down = new Set(["ArrowDown", "j", "J"]);
const up = new Set(["ArrowUp", "k", "K"]);

export function listMove(
  event: ListKey,
  rowKeys: readonly string[],
  sel: string | undefined,
): ListMove | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const at = sel === undefined ? -1 : rowKeys.indexOf(sel);
  if (event.key === "Escape") return sel === undefined ? undefined : { kind: "clear" };
  if (event.key === "Enter") return at === -1 ? undefined : { kind: "open" };
  const step = down.has(event.key) ? 1 : up.has(event.key) ? -1 : 0;
  if (step === 0 || rowKeys.length === 0) return undefined;
  const next =
    at === -1
      ? step === 1
        ? 0
        : rowKeys.length - 1
      : Math.max(0, Math.min(rowKeys.length - 1, at + step));
  const target = rowKeys[next];
  return target === undefined ? undefined : { kind: "select", sel: target };
}

export function assignedOpenPath(task: AssignedTask): string {
  switch (task.status) {
    case "disagreements":
      return destinations.disagreements(task.id);
    case "ready-to-sign-off":
      return destinations.signOff(task.id);
    case "signed-off":
      return destinations.evaluation(task.id);
    case "in-review":
    case "not-started":
      return destinations.team({ task: task.id });
  }
}

export function slideOpenPath(row: SlideRow, me: string | undefined): string {
  const mine = row.reviews.find((review) => review.user_id === me);
  if (mine?.state === "in-review") return destinations.guided(mine.task_id, row.id);
  return destinations.openSlide(row.project.id, row.id, mine?.task_id);
}

const handled = "[role='dialog'], [role='menu'], [role='tablist'], [role='combobox']";
const activates = "button, a, [role='tab'], [role='menuitem'], [role='checkbox']";

export function ignoresListKeys(target: EventTarget | null, key: string): boolean {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  if (element.closest(`input, textarea, select, [contenteditable='true'], ${handled}`)) return true;
  return key === "Enter" && element.closest(activates) !== null;
}
