import { type Comparison, compareFrames, describeComparison, type Tolerance } from "#compare.ts";
import type { Frame } from "#frame.ts";

export const UI_THEMES = ["dark", "light"] as const;

export const UI_DENSITIES = ["comfortable", "compact"] as const;

export type UiTheme = (typeof UI_THEMES)[number];

export type UiDensity = (typeof UI_DENSITIES)[number];

export const UI_TOLERANCE: Tolerance = {
  maxChannelDelta: 16,
  maxDifferingFraction: 0.001,
  maxMeanChannelError: 0.5,
};

export const VISUAL_APPROVE_COMMAND =
  "gh workflow run ci --ref BRANCH -f update_goldens=true, then gh run download RUN -n ui-visual-baselines -D DIRECTORY, pnpm --filter @parfocal/ui visual:publish DIRECTORY, and commit packages/ui/visual-baselines.json";

export interface VisualCase {
  readonly storyId: string;
  readonly theme: UiTheme;
  readonly density: UiDensity;
  readonly name: string;
  readonly fallback: string | null;
}

export function visualName(storyId: string, theme: UiTheme, density: UiDensity): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(storyId)) {
    throw new Error(`A story id must be lowercase kebab case, got "${storyId}"`);
  }
  return `${storyId}--${theme}--${density}`;
}

export function visualCase(storyId: string, theme: UiTheme, density: UiDensity): VisualCase {
  return {
    storyId,
    theme,
    density,
    name: visualName(storyId, theme, density),
    fallback: density === "comfortable" ? null : visualName(storyId, theme, "comfortable"),
  };
}

export function visualCases(
  storyIds: readonly string[],
  excluded: ReadonlySet<string> = new Set(),
): VisualCase[] {
  const cases: VisualCase[] = [];
  for (const storyId of [...new Set(storyIds)].sort()) {
    if (excluded.has(storyId)) {
      continue;
    }
    for (const theme of UI_THEMES) {
      for (const density of UI_DENSITIES) {
        cases.push(visualCase(storyId, theme, density));
      }
    }
  }
  return cases;
}

export function baselineFor(item: VisualCase, existing: ReadonlySet<string>): string | null {
  if (existing.has(item.name)) {
    return item.name;
  }
  if (item.fallback !== null && existing.has(item.fallback)) {
    return item.fallback;
  }
  return null;
}

export function staleBaselines(
  cases: readonly VisualCase[],
  existing: ReadonlySet<string>,
): string[] {
  const known = new Set(cases.map((item) => item.name));
  return [...existing].filter((name) => !known.has(name)).sort();
}

export function isBootstrapping(existing: ReadonlySet<string>): boolean {
  return existing.size === 0;
}

export type VisualJudgement =
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "matched"; readonly baseline: string; readonly comparison: Comparison }
  | { readonly status: "missing"; readonly message: string }
  | {
      readonly status: "differs";
      readonly baseline: string;
      readonly comparison: Comparison;
      readonly message: string;
    }
  | { readonly status: "write"; readonly name: string }
  | { readonly status: "same-as-comfortable"; readonly remove: string | null };

export interface VisualInput {
  readonly item: VisualCase;
  readonly actual: Frame;
  readonly existing: ReadonlySet<string>;
  readonly readBaseline: (name: string) => Frame;
  readonly update: boolean;
  readonly comfortableActual?: Frame;
  readonly tolerance?: Tolerance;
}

export function judgeVisual(input: VisualInput): VisualJudgement {
  const { item, actual, existing, update } = input;
  const tolerance = input.tolerance ?? UI_TOLERANCE;
  if (update) {
    if (item.density === "compact" && input.comfortableActual !== undefined) {
      const same = compareFrames(actual, input.comfortableActual, tolerance).pass;
      if (same) {
        return {
          status: "same-as-comfortable",
          remove: existing.has(item.name) ? item.name : null,
        };
      }
    }
    return { status: "write", name: item.name };
  }
  if (isBootstrapping(existing)) {
    return {
      status: "skipped",
      reason: `No UI baselines are committed yet. Run ${VISUAL_APPROVE_COMMAND}`,
    };
  }
  const baseline = baselineFor(item, existing);
  if (baseline === null) {
    return {
      status: "missing",
      message: `${item.storyId} in ${item.theme} ${item.density} has no baseline. Approve it with ${VISUAL_APPROVE_COMMAND}`,
    };
  }
  const comparison = compareFrames(actual, input.readBaseline(baseline), tolerance);
  if (comparison.pass) {
    return { status: "matched", baseline, comparison };
  }
  return {
    status: "differs",
    baseline,
    comparison,
    message: `${item.storyId} in ${item.theme} ${item.density} does not match ${baseline}.png\n${describeComparison(comparison)}\nIf the change is intended, approve it with ${VISUAL_APPROVE_COMMAND} and commit the changed PNGs so the reviewer sees them`,
  };
}
