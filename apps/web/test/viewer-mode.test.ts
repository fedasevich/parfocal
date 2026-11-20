import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectRole, TaskKind } from "@parfocal/api-client";
import type { ViewerTab } from "../src/screens/viewer/viewer-scenes.ts";
import {
  editAccess,
  type ReadOnlyReason,
  type ViewerAccess,
  viewerAccessOf,
  type WorkspaceRole,
} from "../src/viewer/viewer-access.ts";
import {
  type ModeFacts,
  modeOfWorkspace,
  type PanelFacts,
  panelTabOf,
  type ViewerMode,
  viewerModeOf,
  viewerModes,
  viewerPanelOf,
} from "../src/viewer/viewer-mode.ts";

const readOnly = (reason: ReadOnlyReason): ViewerAccess => ({ kind: "read-only", reason });

const noTask: ModeFacts = {
  hasTask: false,
  taskKind: undefined,
  access: editAccess,
  chosen: undefined,
};

const facts: PanelFacts = {
  taskKind: "review",
  hasResults: true,
  opinionQuestions: 3,
  comments: 0,
};

const annotateFacts: PanelFacts = { ...facts, taskKind: "annotate" };

const accessOf = (role: WorkspaceRole, projectRole: ProjectRole, taskKind?: TaskKind) =>
  viewerAccessOf({
    role,
    projectRole,
    taskKind,
    assigned: taskKind === undefined ? undefined : true,
    withdrawn: false,
    signedOff: false,
  });

test("with no task an owner or a reviewer opens Annotate and a project viewer opens Look only", () => {
  const cases: readonly [WorkspaceRole, ProjectRole, ViewerMode, number][] = [
    ["researcher", "owner", "annotate", 2],
    ["researcher", "reviewer", "annotate", 2],
    ["reviewer", "reviewer", "annotate", 2],
    ["researcher", "viewer", "look", 0],
    ["reviewer", "viewer", "look", 0],
  ];
  for (const [role, projectRole, mode, choices] of cases) {
    const rule = viewerModeOf({ ...noTask, access: accessOf(role, projectRole) });
    assert.equal(rule.mode, mode, `${role} as ${projectRole}`);
    assert.equal(rule.choices.length, choices, `${role} as ${projectRole}`);
    assert.ok(!(mode === "look" && rule.choices.includes("annotate")));
  }
});

test("a project viewer stays in Look even when the address asks for Annotate", () => {
  const rule = viewerModeOf({ ...noTask, access: readOnly("no-review-right"), chosen: "annotate" });
  assert.equal(rule.mode, "look");
  assert.equal(rule.workspace, "look");
  assert.deepEqual(rule.choices, []);
});

test("with no task the Look choice opens Look with the look rail", () => {
  const rule = viewerModeOf({ ...noTask, chosen: "look" });
  assert.equal(rule.mode, "look");
  assert.equal(rule.workspace, "look");
  assert.equal(rule.choice, "look");
  assert.deepEqual(rule.choices, ["look", "annotate"]);
});

test("the address, the switch and the code name the mode with one word", () => {
  const review = { ...noTask, hasTask: true, taskKind: "review" as const };
  for (const mode of ["review", "guided", "annotate"] as const) {
    const rule = viewerModeOf({ ...review, chosen: mode });
    assert.equal(rule.mode, mode);
    assert.equal(rule.choice, mode);
    assert.ok(rule.choices.includes(rule.choice));
  }
  for (const mode of ["look", "annotate"] as const) {
    const rule = viewerModeOf({ ...noTask, chosen: mode });
    assert.equal(rule.choice, mode);
    assert.ok(rule.choices.includes(rule.choice));
  }
  assert.equal(viewerModeOf({ ...review, chosen: "cells" }).choice, "review");
});

test("the same task kind always offers the same modes, whatever the address asks", () => {
  const review = { ...noTask, hasTask: true, taskKind: "review" as const };
  const annotate = { ...noTask, hasTask: true, taskKind: "annotate" as const };
  for (const chosen of [undefined, ...viewerModes]) {
    assert.deepEqual(
      viewerModeOf({ ...noTask, chosen }).choices,
      ["look", "annotate"],
      String(chosen),
    );
    assert.deepEqual(
      viewerModeOf({ ...review, chosen }).choices,
      ["guided", "review", "annotate"],
      String(chosen),
    );
    assert.deepEqual(viewerModeOf({ ...annotate, chosen }).choices, [], String(chosen));
    assert.equal(viewerModeOf({ ...annotate, chosen }).mode, "annotate", String(chosen));
  }
});

test("the mode follows the task kind and never the entry point", () => {
  const review = { ...noTask, hasTask: true, taskKind: "review" as const };
  assert.equal(viewerModeOf(review).mode, "review");
  assert.equal(viewerModeOf({ ...review, chosen: "look" }).mode, "review");
  assert.equal(viewerModeOf({ ...review, chosen: "guided" }).mode, "guided");
  assert.equal(viewerModeOf({ ...review, chosen: "cells" }).mode, "cells");
  assert.equal(viewerModeOf({ ...review, chosen: "annotate" }).workspace, "annotate");
  assert.equal(viewerModeOf({ ...noTask, chosen: "review" }).mode, "annotate");
});

test("an old workspace value maps to the mode of the same name", () => {
  assert.equal(modeOfWorkspace("annotate", false), "annotate");
  assert.equal(modeOfWorkspace("annotate", true), "annotate");
  assert.equal(modeOfWorkspace("review", false), "look");
  assert.equal(modeOfWorkspace("review", true), "review");
});

test("a read only review task opens Review and is not offered Guided", () => {
  for (const reason of ["not-assigned", "signed-off", "withdrawn"] as const) {
    const rule = viewerModeOf({
      ...noTask,
      hasTask: true,
      taskKind: "review",
      access: readOnly(reason),
      chosen: "annotate",
    });
    assert.equal(rule.mode, "review", reason);
    assert.deepEqual(rule.choices, [], reason);
  }
});

const rows: readonly {
  name: string;
  mode: ViewerMode;
  access: ViewerAccess;
  facts: PanelFacts;
  tabs: readonly ViewerTab[];
  first: ViewerTab;
  submit: boolean;
  draw: boolean;
  tools: readonly string[];
}[] = [
  {
    name: "no task, owner",
    mode: "annotate",
    access: editAccess,
    facts: { ...facts, taskKind: undefined },
    tabs: ["objects", "display", "comments"],
    first: "display",
    submit: false,
    draw: true,
    tools: ["select", "hand", "smart", "auto", "poly"],
  },
  {
    name: "no task, Look with result sets",
    mode: "look",
    access: editAccess,
    facts: { ...facts, taskKind: undefined },
    tabs: ["objects", "display", "comments"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler", "comment", "smart"],
  },
  {
    name: "no task, project viewer, no comments",
    mode: "look",
    access: readOnly("no-review-right"),
    facts: { ...facts, taskKind: undefined, hasResults: false },
    tabs: ["objects", "display"],
    first: "display",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "no task, project viewer, with comments",
    mode: "look",
    access: readOnly("no-review-right"),
    facts: { ...facts, taskKind: undefined, comments: 2 },
    tabs: ["objects", "display", "comments"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "review task, assigned",
    mode: "review",
    access: editAccess,
    facts,
    tabs: ["objects", "display", "comments", "opinion"],
    first: "objects",
    submit: true,
    draw: false,
    tools: ["select", "hand", "ruler", "comment", "smart"],
  },
  {
    name: "review task, guided",
    mode: "guided",
    access: editAccess,
    facts,
    tabs: ["objects", "comments", "display"],
    first: "objects",
    submit: true,
    draw: false,
    tools: [],
  },
  {
    name: "review task, cell typing",
    mode: "cells",
    access: editAccess,
    facts,
    tabs: ["objects", "display", "comments", "opinion"],
    first: "objects",
    submit: true,
    draw: false,
    tools: ["select", "hand", "ruler", "comment", "smart"],
  },
  {
    name: "review task, not assigned",
    mode: "review",
    access: readOnly("not-assigned"),
    facts,
    tabs: ["objects", "display"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "review task, signed off",
    mode: "review",
    access: readOnly("signed-off"),
    facts,
    tabs: ["objects", "display", "comments", "opinion"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "review task, signed off, no opinion asked",
    mode: "review",
    access: readOnly("signed-off"),
    facts: { ...facts, opinionQuestions: 0 },
    tabs: ["objects", "display", "comments"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "review task, withdrawn",
    mode: "review",
    access: readOnly("withdrawn"),
    facts,
    tabs: ["objects", "display", "opinion"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "annotate task, assigned expert",
    mode: "annotate",
    access: editAccess,
    facts: annotateFacts,
    tabs: ["objects", "display", "comments"],
    first: "objects",
    submit: false,
    draw: true,
    tools: ["select", "hand", "smart", "auto", "poly", "brush"],
  },
  {
    name: "annotate task, not assigned",
    mode: "annotate",
    access: readOnly("not-assigned"),
    facts: annotateFacts,
    tabs: ["objects", "display"],
    first: "objects",
    submit: false,
    draw: false,
    tools: ["select", "hand", "ruler"],
  },
  {
    name: "annotate task, signed off keeps the locked panel and the rail",
    mode: "annotate",
    access: readOnly("signed-off"),
    facts: annotateFacts,
    tabs: ["objects", "display", "comments"],
    first: "objects",
    submit: false,
    draw: true,
    tools: ["select", "hand", "smart", "auto", "poly"],
  },
];

for (const row of rows) {
  test(`the panel table row: ${row.name}`, () => {
    const panel = viewerPanelOf(row.mode, row.access, row.facts);
    assert.deepEqual(panel.tabs, row.tabs);
    assert.equal(panel.first, row.first);
    assert.ok(panel.tabs.includes(panel.first));
    assert.equal(panel.submit, row.submit);
    assert.equal(panel.decide, row.submit);
    assert.equal(panel.draw, row.draw);
    assert.equal(panel.toolKeys, row.tools.length > 0);
    for (const tool of row.tools) assert.ok(panel.tools.includes(tool), `${row.name} has ${tool}`);
    if (row.access.kind === "read-only" && !row.draw)
      assert.deepEqual(panel.tools, ["select", "hand", "ruler"]);
    if (panel.comment) assert.ok(panel.tabs.includes("comments"));
  });
}

test("Annotate on a review task opens on Display with the layers, an annotate task on Objects", () => {
  assert.equal(viewerPanelOf("annotate", editAccess, facts).first, "display");
  assert.equal(viewerPanelOf("annotate", editAccess, annotateFacts).first, "objects");
  assert.equal(viewerPanelOf("annotate", editAccess, facts).submit, false);
});

test("tool keys follow the rail, so they are off in guided, focus and the object layout", () => {
  assert.equal(viewerPanelOf("review", editAccess, facts).toolKeys, true);
  assert.equal(viewerPanelOf("review", editAccess, { ...facts, layout: "compare" }).toolKeys, true);
  assert.equal(viewerPanelOf("guided", editAccess, facts).toolKeys, false);
  assert.equal(viewerPanelOf("review", editAccess, { ...facts, layout: "focus" }).toolKeys, false);
  assert.equal(
    viewerPanelOf("annotate", editAccess, { ...annotateFacts, layout: "focus" }).toolKeys,
    false,
  );
  assert.equal(viewerPanelOf("look", editAccess, { ...facts, layout: "object" }).toolKeys, false);
});

test("a tab the table does not show falls back to the first tab", () => {
  const panel = viewerPanelOf("review", readOnly("not-assigned"), facts);
  assert.equal(panelTabOf(panel, "opinion"), "objects");
  assert.equal(panelTabOf(panel, "comments"), "objects");
  assert.equal(panelTabOf(panel, "display"), "display");
  assert.equal(panelTabOf(panel, undefined), "objects");
});

test("a slide that cannot open turns every tab, tool and answer off", () => {
  for (const mode of viewerModes) {
    const panel = viewerPanelOf(mode, editAccess, { ...annotateFacts, openFailed: true });
    assert.deepEqual(panel.tabs, []);
    assert.deepEqual(panel.tools, []);
    assert.equal(panel.rail, false);
    assert.equal(panel.toolKeys, false);
    assert.equal(panel.draw, false);
    assert.equal(panel.submit, false);
    assert.equal(panel.decide, false);
    assert.equal(panel.openFailed, true);
  }
  assert.equal(viewerPanelOf("annotate", editAccess, annotateFacts).rail, true);
});
