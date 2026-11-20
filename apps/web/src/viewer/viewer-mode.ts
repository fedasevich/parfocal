import type { TaskKind } from "@parfocal/api-client";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { lookOnlyLayer, type ViewerAccess } from "./viewer-access.ts";
import { type SlideWorkspace, setupOf } from "./workspace.ts";

export type ViewerMode = "look" | "annotate" | "review" | "guided" | "cells";

export type ModeChoice = "guided" | "review" | "annotate";

export type ModeFacts = {
  readonly hasTask: boolean;
  readonly taskKind: TaskKind | undefined;
  readonly access: ViewerAccess;
  readonly chosen: SlideWorkspace | undefined;
  readonly guided: boolean;
  readonly cells: boolean;
};

export type ModeRule = {
  readonly mode: ViewerMode;
  readonly workspace: SlideWorkspace;
  readonly choices: readonly ModeChoice[];
};

const workspaceOf: Record<ViewerMode, SlideWorkspace> = {
  look: "review",
  annotate: "annotate",
  review: "review",
  guided: "review",
  cells: "review",
};

const rule = (mode: ViewerMode, choices: readonly ModeChoice[]): ModeRule => ({
  mode,
  workspace: workspaceOf[mode],
  choices,
});

export function viewerModeOf(facts: ModeFacts): ModeRule {
  const edit = facts.access.kind === "edit";
  if (!facts.hasTask) {
    if (!edit) return rule("look", []);
    return rule(facts.chosen === "review" ? "look" : "annotate", ["review", "annotate"]);
  }
  if (facts.taskKind === "annotate") return rule("annotate", []);
  if (facts.taskKind === undefined) return rule("review", []);
  const reviewChoices: readonly ModeChoice[] = edit ? ["guided", "review"] : [];
  if (facts.guided) return rule("guided", reviewChoices);
  if (facts.cells) return rule("cells", reviewChoices);
  if (edit && facts.chosen === "annotate")
    return rule("annotate", ["guided", "review", "annotate"]);
  return rule("review", reviewChoices);
}

export type PanelFacts = {
  readonly taskKind: TaskKind | undefined;
  readonly hasResults: boolean;
  readonly opinionQuestions: number | undefined;
  readonly comments: number;
};

export type ViewerPanel = {
  readonly tabs: readonly ViewerTab[];
  readonly first: ViewerTab;
  readonly readOnly: boolean;
  readonly tools: readonly string[];
  readonly toolKeys: boolean;
  readonly decide: boolean;
  readonly submit: boolean;
  readonly draw: boolean;
  readonly comment: boolean;
};

const reviewModes: ReadonlySet<ViewerMode> = new Set(["review", "guided", "cells"]);

function stageReadOnly(access: ViewerAccess, taskKind: TaskKind | undefined): boolean {
  if (taskKind === "annotate") return lookOnlyLayer(access);
  return access.kind === "read-only";
}

function commentsAllowed(access: ViewerAccess): boolean {
  return access.kind === "edit" || access.reason === "signed-off";
}

function opinionShown(mode: ViewerMode, access: ViewerAccess, facts: PanelFacts): boolean {
  if (mode !== "review" && mode !== "cells") return false;
  if (access.kind === "edit") return true;
  if (access.reason === "not-assigned" || access.reason === "no-review-right") return false;
  return facts.opinionQuestions === undefined || facts.opinionQuestions > 0;
}

function firstTab(mode: ViewerMode, facts: PanelFacts): ViewerTab {
  if (mode === "look") return facts.hasResults ? "objects" : "display";
  if (mode === "annotate") return facts.taskKind === "annotate" ? "objects" : "display";
  return "objects";
}

export function viewerPanelOf(
  mode: ViewerMode,
  access: ViewerAccess,
  facts: PanelFacts,
): ViewerPanel {
  const readOnly = stageReadOnly(access, facts.taskKind);
  const comment = commentsAllowed(access);
  const comments: ViewerTab[] = comment || facts.comments > 0 ? ["comments"] : [];
  const opinion: ViewerTab[] = opinionShown(mode, access, facts) ? ["opinion"] : [];
  const tabs: ViewerTab[] =
    mode === "guided"
      ? ["objects", ...comments, "display"]
      : ["objects", "display", ...comments, ...opinion];
  const tools =
    mode === "guided"
      ? []
      : setupOf(workspaceOf[mode], readOnly).rail.flatMap((group) =>
          group.map((item) => item.tool),
        );
  const reviewing = reviewModes.has(mode) && facts.taskKind === "review";
  return {
    tabs,
    first: firstTab(mode, facts),
    readOnly,
    tools,
    toolKeys: tools.length > 0,
    decide: reviewing && access.kind === "edit",
    submit: reviewing && access.kind === "edit",
    draw: mode === "annotate" && !readOnly,
    comment: comment && tools.includes("comment"),
  };
}

export function panelTabOf(panel: ViewerPanel, wanted: ViewerTab | undefined): ViewerTab {
  return wanted !== undefined && panel.tabs.includes(wanted) ? wanted : panel.first;
}
