export const susItemCount = 10;

export const seqPoints = 7;

export function susScoreTenths(answers: readonly number[]): number | null {
  if (answers.length !== susItemCount) return null;
  let sum = 0;
  for (const [index, answer] of answers.entries()) {
    if (!Number.isInteger(answer) || answer < 1 || answer > 5) return null;
    sum += index % 2 === 0 ? answer - 1 : 5 - answer;
  }
  return sum * 25;
}
