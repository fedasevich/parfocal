import { type RefObject, useEffect } from "react";

type Matches = { matches: (selector: string) => boolean };

type Closest = { closest: (selector: string) => Matches | null };

const typingSelector = "input, textarea, select, [contenteditable]";

const controlSelector =
  'button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"]';

const toolSelector = "[data-tool], [aria-pressed]";

const hasClosest = (target: unknown): target is Closest =>
  typeof target === "object" &&
  target !== null &&
  typeof (target as { closest?: unknown }).closest === "function";

export function enterAcceptsProposals(target: unknown): boolean {
  if (!hasClosest(target)) return true;
  if (target.closest(typingSelector) !== null) return false;
  const control = target.closest(controlSelector);
  return control === null || control.matches(toolSelector);
}

type Blurrable = Closest & Matches & { blur: () => void };

const isBlurrable = (target: unknown): target is Blurrable =>
  hasClosest(target) && typeof (target as { blur?: unknown }).blur === "function";

export function controlToRelease(pressed: unknown, focused: unknown): Blurrable | null {
  if (!enterAcceptsProposals(pressed) || hasControl(pressed)) return null;
  if (!isBlurrable(focused) || focused.closest(typingSelector) !== null) return null;
  return enterAcceptsProposals(focused) ? null : focused;
}

function hasControl(target: unknown): boolean {
  return hasClosest(target) && target.closest(controlSelector) !== null;
}

export type ProposalKeys = {
  readonly proposalCount: number;
  readonly acceptProposals: () => void;
};

export function useProposalEnter(
  now: RefObject<ProposalKeys>,
  draft: RefObject<{ depth: () => number } | null>,
): void {
  useEffect(() => {
    const onEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if (now.current.proposalCount === 0) return;
      if (!enterAcceptsProposals(event.target) || (draft.current?.depth() ?? 0) > 0) return;
      event.preventDefault();
      now.current.acceptProposals();
    };
    const onPress = (event: PointerEvent) => {
      controlToRelease(event.target, document.activeElement)?.blur();
    };
    window.addEventListener("keydown", onEnter);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onEnter);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [now, draft]);
}
