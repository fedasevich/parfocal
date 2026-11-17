import { HttpResponse, http, type RequestHandler } from "msw";

const deleted = new Set<string>();

export const withoutDeleted = <T extends { id: string }>(sets: readonly T[]): T[] =>
  sets.filter((set) => !deleted.has(set.id));

export const deletedResultSetHandlers = (): RequestHandler[] => [
  http.delete<{ resultSetId: string }>("*/api/result-sets/:resultSetId", ({ params }) => {
    deleted.add(params.resultSetId);
    return HttpResponse.json({ tasks: 0, decisions: 0 });
  }),
];
