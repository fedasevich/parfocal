export function presetProblem(name: string, taken: string[]) {
  const trimmed = name.trim();
  if (trimmed === "") return "Name the preset.";
  const clash = ["Task default", ...taken].find(
    (item) => item.toLowerCase() === trimmed.toLowerCase(),
  );
  return clash ? `You already have a preset called ${clash}.` : null;
}
