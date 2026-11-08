import { keyRegistry } from "../keys/catalogue.ts";
import type { Binding, Fired } from "../keys/registry.ts";

export type CheckState = "unchecked" | "confirmed" | "edited" | "deleted";

export type CheckProgress = {
  scope: number;
  checked: number;
  unchecked: number;
  confirmed: number;
  edited: number;
  deleted: number;
};

type Checkable = { kind: "ai" | "human"; check: CheckState };

export const confirmAction = "aconfirm";

export const confirmActions = [confirmAction];

export function confirmBindings(): Binding[] {
  return keyRegistry.bindings({ scopes: ["annotate"], only: confirmActions });
}

export const confirms = (fired: Fired) => fired.phase === "press" && fired.action === confirmAction;

export const canConfirm = (object: Checkable | undefined) =>
  object?.kind === "ai" && object.check === "unchecked";

export function confirmedCopy<T extends Checkable & { origin: string }>(object: T): T {
  return { ...object, origin: "ai-confirmed", check: "confirmed" };
}

export function checkProgressOf(objects: readonly Checkable[]): CheckProgress {
  const ai = objects.filter((object) => object.kind === "ai");
  const count = (state: CheckState) => ai.filter((object) => object.check === state).length;
  const unchecked = count("unchecked");
  return {
    scope: ai.length,
    checked: ai.length - unchecked,
    unchecked,
    confirmed: count("confirmed"),
    edited: count("edited"),
    deleted: count("deleted"),
  };
}

export const progressLine = (progress: CheckProgress) =>
  `${progress.checked} of ${progress.scope} checked`;
