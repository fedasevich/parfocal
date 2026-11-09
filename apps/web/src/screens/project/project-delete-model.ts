export type DeleteCounts = {
  cases: number;
  slides: number;
  resultSets: number;
  tasks: number;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const whatGoes = (counts: DeleteCounts): string[] =>
  [
    counts.cases > 0 ? plural(counts.cases, "case", "cases") : null,
    counts.slides > 0 ? plural(counts.slides, "slide", "slides") : null,
    counts.resultSets > 0 ? plural(counts.resultSets, "result set", "result sets") : null,
    counts.tasks > 0 ? plural(counts.tasks, "review task", "review tasks") : null,
  ].filter((line): line is string => line !== null);

export const deleteBlockers = (typed: string, name: string): string[] => {
  const entered = typed.trim();
  if (entered === name.trim()) return [];
  return [entered === "" ? `Type ${name.trim()} to confirm.` : "The name does not match."];
};

export const deleteTitle = (code: string) => `Delete ${code}?`;

export const keptNote =
  "Its slides, stored files, result sets, review tasks, decisions, evaluations and audit entries stay in storage, and an owner can restore the project.";

export const deletedToast = (code: string, name: string) =>
  `${code} ${name} is deleted. Nothing was erased.`;
