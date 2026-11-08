export const susItems: readonly string[] = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
];

export const susScale: readonly string[] = [
  "Strongly disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly agree",
];

export const seqQuestion = "Overall, this task was";

export const seqEnds = { low: "Very difficult", high: "Very easy" } as const;

export const seqPoints = 7;

export function susScoreTenths(answers: readonly number[]): number | null {
  if (answers.length !== susItems.length) return null;
  let sum = 0;
  for (const [index, answer] of answers.entries()) {
    if (!Number.isInteger(answer) || answer < 1 || answer > 5) return null;
    sum += index % 2 === 0 ? answer - 1 : 5 - answer;
  }
  return sum * 25;
}
