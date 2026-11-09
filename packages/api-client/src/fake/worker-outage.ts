import { aiModels } from "./scenario-admin.ts";

const labModelName = "lab-hovernet-fork";

const seededStatus = new Map(aiModels.map((model) => [model.id, model.status]));
const seededLatency = new Map(aiModels.map((model) => [model.id, model.latencyMs]));

let offline = new Set<string>();

export const isWorkerOffline = (name: string | null | undefined): boolean =>
  name !== null && name !== undefined && offline.has(name);

export const servingOf = (name: string | null | undefined): "ready" | "offline" =>
  isWorkerOffline(name) ? "offline" : "ready";

const nameInList = (model: (typeof aiModels)[number]) =>
  model.source === "lab" ? labModelName : model.catalogueName;

const applyToAdminList = () => {
  for (const model of aiModels) {
    const original = seededStatus.get(model.id) ?? model.status;
    const servesHere = model.source !== "lab" || original === "answering";
    const down = servesHere && isWorkerOffline(nameInList(model));
    model.status = down ? "offline" : original;
    model.latencyMs = down ? null : (seededLatency.get(model.id) ?? null);
  }
};

export const takeWorkersOffline = (...names: string[]) => {
  offline = new Set(names);
  applyToAdminList();
};

export const bringWorkersBack = () => {
  offline = new Set();
  applyToAdminList();
};
