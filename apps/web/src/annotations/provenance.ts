import type { HistoryEntry, ModelInfo, Origin } from "@parfocal/ui/components/annotate-task";
import type { PersonInfo } from "@parfocal/ui/lib/avatar-colours";

export type ProvenanceObject = {
  id: string;
  code: string;
  origin: "human" | "ai" | "ai-edited";
  created_by_user_id: string | null;
  changed_by_user_id: string | null;
  deleted_at: string | null;
};

export type ProvenanceVersion = {
  version: number;
  change: "created" | "edited" | "deleted" | "restored";
  class_id: string | null;
  changed_by_user_id: string | null;
  changed_at: string;
};

export type ProvenanceModel = ModelInfo & { madeAt?: string | null | undefined };

export type Provenance = {
  origin: Origin;
  author: PersonInfo | undefined;
  model: ModelInfo | undefined;
  history: HistoryEntry[];
};

export type ProvenanceInput = {
  object: ProvenanceObject;
  versions: ProvenanceVersion[];
  model: ProvenanceModel | null;
  personOf: (userId: string) => PersonInfo | undefined;
  clock: (iso: string) => string;
};

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function whatChanged(
  change: ProvenanceVersion["change"],
  first: boolean,
  origin: ProvenanceObject["origin"],
  retyped: boolean,
) {
  if (change === "deleted") return "Deleted";
  if (change === "restored") return "Restored";
  if (first) return origin === "human" ? "Drew the shape" : "Fixed the AI object";
  return retyped ? "Changed the class" : "Changed the outline";
}

export function provenanceOf({
  object,
  versions,
  model,
  personOf,
  clock,
}: ProvenanceInput): Provenance {
  const ordered = [...versions].sort((left, right) => left.version - right.version);
  const aiMade = object.origin !== "human";
  const history: HistoryEntry[] = [];
  const modelInfo = aiMade && model ? { name: model.name, version: model.version } : undefined;
  if (aiMade && model) {
    const label = model.version ? `${model.name} ${model.version}` : model.name;
    history.push({
      id: "made",
      who: null,
      what: `Made by ${label}`,
      when: model.madeAt ? clock(model.madeAt) : "",
    });
  }
  ordered.forEach((entry, index) => {
    const before = ordered[index - 1];
    const retyped = before !== undefined && before.class_id !== entry.class_id;
    history.push({
      id: `version-${entry.version}`,
      who: entry.changed_by_user_id ? (personOf(entry.changed_by_user_id) ?? null) : null,
      what: whatChanged(entry.change, index === 0, object.origin, retyped),
      when: clock(entry.changed_at),
    });
  });
  const authorId = object.changed_by_user_id ?? object.created_by_user_id;
  const author = authorId ? personOf(authorId) : undefined;
  const origin: Origin = object.origin === "ai-edited" && !author ? "ai" : object.origin;
  return { origin, author, model: modelInfo, history };
}
