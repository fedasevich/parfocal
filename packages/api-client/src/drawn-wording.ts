const wholeLabels: Record<string, string> = {
  "Is the AI result acceptable for this slide?":
    "Are the drawn outlines acceptable for this slide?",
  "Is the AI result acceptable?": "Are the drawn outlines acceptable?",
  "Did the AI change your answer?": "Did the drawn outlines change your answer?",
};

const phrases: [RegExp, string][] = [
  [/\bIs the AI result\b/g, "Are the drawn outlines"],
  [/\bis the AI result\b/g, "are the drawn outlines"],
  [/\bIs the AI\b/g, "Are the drawn outlines"],
  [/\bDoes the AI\b/g, "Do the drawn outlines"],
  [/\bthe AI result\b/g, "the drawn outlines"],
  [/\bThe AI result\b/g, "The drawn outlines"],
  [/\bthe AI's\b/g, "the drawn"],
  [/\bThe AI's\b/g, "The drawn"],
  [/\bthe AI\b/g, "the drawn outlines"],
  [/\bThe AI\b/g, "The drawn outlines"],
];

export const drawnText = (text: string) =>
  wholeLabels[text] ??
  phrases.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);

export const textFor = (text: string, drawn: boolean) => (drawn ? drawnText(text) : text);
