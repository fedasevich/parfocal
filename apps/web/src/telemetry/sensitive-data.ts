import type { QueryClient } from "@tanstack/react-query";
import type { SensitiveValues } from "./scrubbing.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

function registerPerson(record: Record<string, unknown>, sensitive: SensitiveValues): void {
  sensitive.register(text(record.name), text(record.mrn));
}

export function learnSensitive(value: unknown, sensitive: SensitiveValues, depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(value)) {
    for (const entry of value) learnSensitive(entry, sensitive, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (isRecord(value.patient)) registerPerson(value.patient, sensitive);
  if (typeof value.patient_id === "string") registerPerson(value, sensitive);
  if (value.kind === "patient") sensitive.register(text(value.label));
  sensitive.register(text(value.display_name), text(value.patient_name));
  for (const entry of Object.values(value)) learnSensitive(entry, sensitive, depth + 1);
}

export function watchSensitiveData(queryClient: QueryClient, sensitive: SensitiveValues) {
  const learn = (data: unknown) => learnSensitive(data, sensitive);
  const queries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success") learn(event.query.state.data);
  });
  const mutations = queryClient.getMutationCache().subscribe((event) => {
    if (event?.type !== "updated") return;
    if (event.action.type === "pending") learn(event.mutation.state.variables);
    if (event.action.type === "success") learn(event.mutation.state.data);
  });
  return () => {
    queries();
    mutations();
  };
}
