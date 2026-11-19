export const reasonMin = 10;
export const reasonMax = 500;

export const looseTarget = "loose";

export const slideDragType = "application/x-parfocal-slide";

export type CaseChoice = { id: string; label: string };

export type MovedSlide = {
  id: string;
  title: string;
  fromCaseId: string | null;
  fromLabel: string | null;
};

export const moveTitle = (filed: boolean) => (filed ? "Move to another case" : "File into a case");

export const targetChoices = (cases: CaseChoice[], currentLabel: string | null) =>
  cases.filter((item) => item.label !== currentLabel);

export const caseIdOfTarget = (target: string): string | null =>
  target === looseTarget ? null : target;

export const moveErrors = (caseId: string, reason: string): string[] => {
  const errors: string[] = [];
  if (caseId === "") errors.push("Pick the case.");
  const length = reason.trim().length;
  if (length < reasonMin) errors.push(`Give a reason of at least ${reasonMin} characters.`);
  if (length > reasonMax) errors.push(`Keep the reason within ${reasonMax} characters.`);
  return errors;
};

export const canDrop = (slideCaseLabel: string | null, targetLabel: string | null) =>
  slideCaseLabel !== targetLabel;

export const dragReason = (targetLabel: string | null) =>
  targetLabel === null
    ? "Dragged to the loose slides on the Slides tab"
    : `Dragged to case ${targetLabel} on the Slides tab`;

export const undoReason = (fromLabel: string | null) =>
  fromLabel === null
    ? "Undid a move, back to the loose slides"
    : `Undid a move, back to case ${fromLabel}`;
