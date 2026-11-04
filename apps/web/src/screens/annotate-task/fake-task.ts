import type { CheckState, HistoryEntry, Origin } from "@parfocal/ui/components/annotate-task";
import type { PersonInfo } from "@parfocal/ui/lib/avatar-colours";
import { autoRegionProposals } from "../viewer-tools/tool-geometry.ts";

export type { TaskScene } from "./scene-list.ts";

export type TaskPeople = Record<"me" | "anna" | "simona", PersonInfo>;

export const resultName = "CAMELYON v1.0";

export type TaskObject = {
  id: string;
  kind: "ai" | "human";
  origin: Origin;
  check: CheckState;
  classKey: "tumor" | "immune";
  x: number;
  y: number;
  path: string;
  score: number;
  author: PersonInfo | undefined;
  history: HistoryEntry[];
  changedBy: PersonInfo | undefined;
};

export const classOf = {
  tumor: { label: "Tumor", colour: "var(--c-tumor)" },
  immune: { label: "Immune", colour: "var(--c-immune)" },
} as const;

const made: HistoryEntry = { id: "made", who: null, what: `Made by ${resultName}`, when: "09:58" };

const confirmedBy = (index: number, people: TaskPeople) =>
  [people.me, people.anna, people.simona][index % 3];

const editedBy = (index: number, people: TaskPeople) => [people.anna, people.me][index % 2];

function aiObject(index: number, people: TaskPeople): TaskObject {
  const proposal = autoRegionProposals[index];
  if (proposal === undefined) throw new Error(`no proposal ${index}`);
  const base = {
    id: `O${index + 1}`,
    kind: "ai" as const,
    classKey: index % 9 === 4 ? ("immune" as const) : ("tumor" as const),
    x: proposal.x,
    y: proposal.y,
    path: proposal.path,
    score: Math.round((0.52 + ((index * 37) % 46) / 100) * 100) / 100,
    changedBy: undefined,
  };
  if (index < 14) {
    const who = confirmedBy(index, people);
    return {
      ...base,
      origin: "ai-confirmed",
      check: "confirmed",
      author: who,
      history: [
        made,
        {
          id: "confirmed",
          who: who ?? null,
          what: "Confirmed, geometry kept",
          when: `10:${10 + index}`,
        },
      ],
    };
  }
  if (index < 19) {
    const who = editedBy(index, people);
    return {
      ...base,
      origin: "ai-edited",
      check: "edited",
      author: who,
      history: [
        made,
        { id: "edited", who: who ?? null, what: "Moved the outline", when: `10:${30 + index}` },
      ],
    };
  }
  if (index < 21) {
    return {
      ...base,
      origin: "ai",
      check: "deleted",
      author: people.me,
      history: [
        made,
        { id: "deleted", who: people.me, what: "Deleted, not a nucleus", when: "10:52" },
      ],
    };
  }
  return { ...base, origin: "ai", check: "unchecked", author: undefined, history: [made] };
}

const diamond = (x: number, y: number, r: number) =>
  `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`;

const handDrawn: { x: number; y: number; r: number; by: "me" | "anna" | "simona"; when: string }[] =
  [
    { x: 700, y: 790, r: 16, by: "anna", when: "10:44" },
    { x: 840, y: 700, r: 14, by: "me", when: "10:48" },
    { x: 610, y: 760, r: 13, by: "simona", when: "11:02" },
  ];

function handObject(index: number, people: TaskPeople): TaskObject {
  const spec = handDrawn[index];
  if (spec === undefined) throw new Error(`no hand object ${index}`);
  const who = people[spec.by];
  return {
    id: `H${index + 1}`,
    kind: "human",
    origin: "human",
    check: "unchecked",
    classKey: "tumor",
    x: spec.x,
    y: spec.y,
    path: diamond(spec.x, spec.y, spec.r),
    score: 1,
    author: who,
    history: [{ id: "drawn", who, what: "Drew the outline", when: spec.when }],
    changedBy: undefined,
  };
}

export const aiObjectCount = autoRegionProposals.length;

export const freshObjects = (people: TaskPeople): TaskObject[] => [
  ...autoRegionProposals.map((_, index) => aiObject(index, people)),
  ...handDrawn.map((_, index) => handObject(index, people)),
];

export const runColumns = 6;
export const runRows = 4;
export const runTileTotal = runColumns * runRows;
export const runSlide = { width: 1600, height: 1000 };

export const runOrder = Array.from({ length: runTileTotal }, (_, index) => {
  const row = Math.floor(index / runColumns);
  const column = index % runColumns;
  return row * runColumns + (row % 2 === 0 ? column : runColumns - 1 - column);
});

export const cellsPerTile = 8;

export function runCells(tile: number): TaskObject[] {
  const tileWidth = runSlide.width / runColumns;
  const tileHeight = runSlide.height / runRows;
  const left = (tile % runColumns) * tileWidth;
  const top = Math.floor(tile / runColumns) * tileHeight;
  return Array.from({ length: cellsPerTile }, (_, cell) => {
    const x = left + 30 + ((cell * 71 + tile * 29) % (tileWidth - 60));
    const y = top + 30 + ((cell * 47 + tile * 53) % (tileHeight - 60));
    return {
      id: `R${tile * cellsPerTile + cell + 1}`,
      kind: "ai",
      origin: "ai",
      check: "unchecked",
      classKey: cell % 5 === 0 ? "immune" : "tumor",
      x,
      y,
      path: diamond(x, y, 11),
      score: 0.7,
      author: undefined,
      history: [made],
      changedBy: undefined,
    };
  });
}

export type LiveChanges = {
  patches: Record<string, (object: TaskObject) => TaskObject>;
  added: TaskObject[];
  by: PersonInfo[];
};

export const liveChangesOf = (people: TaskPeople): LiveChanges => ({
  patches: {
    O30: (object) => ({
      ...object,
      origin: "ai-confirmed",
      check: "confirmed",
      author: people.anna,
      changedBy: people.anna,
      history: [
        ...object.history,
        { id: "live", who: people.anna, what: "Confirmed, geometry kept", when: "11:14" },
      ],
    }),
    O31: (object) => ({
      ...object,
      origin: "ai-edited",
      check: "edited",
      author: people.simona,
      changedBy: people.simona,
      history: [
        ...object.history,
        { id: "live", who: people.simona, what: "Moved the outline", when: "11:15" },
      ],
    }),
  },
  added: [
    {
      id: "H4",
      kind: "human",
      origin: "human",
      check: "unchecked",
      classKey: "tumor",
      x: 790,
      y: 815,
      path: diamond(790, 815, 15),
      score: 1,
      author: people.anna,
      changedBy: people.anna,
      history: [{ id: "drawn", who: people.anna, what: "Drew the outline", when: "11:16" }],
    },
  ],
  by: [people.anna, people.simona],
});

export const checkCountsOf = (objects: TaskObject[]) => {
  const ai = objects.filter((object) => object.kind === "ai");
  return {
    confirmed: ai.filter((object) => object.check === "confirmed").length,
    edited: ai.filter((object) => object.check === "edited").length,
    deleted: ai.filter((object) => object.check === "deleted").length,
    total: ai.length,
  };
};
