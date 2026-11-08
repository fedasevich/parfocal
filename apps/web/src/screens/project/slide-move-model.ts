export const reasonMin = 10;
export const reasonMax = 500;

export type CaseChoice = { id: string; label: string };

export const moveTitle = (filed: boolean) => (filed ? "Move to another case" : "File into a case");

export const targetChoices = (cases: CaseChoice[], currentLabel: string | null) =>
  cases.filter((item) => item.label !== currentLabel);

export const moveErrors = (caseId: string, reason: string): string[] => {
  const errors: string[] = [];
  if (caseId === "") errors.push("Pick the case.");
  const length = reason.trim().length;
  if (length < reasonMin) errors.push(`Give a reason of at least ${reasonMin} characters.`);
  if (length > reasonMax) errors.push(`Keep the reason within ${reasonMax} characters.`);
  return errors;
};
