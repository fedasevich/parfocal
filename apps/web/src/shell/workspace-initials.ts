export const initialsOf = (name: string) =>
  (name.split(" · ").at(-1) ?? name)
    .split(/\s+/)
    .filter((word) => /^\p{Lu}/u.test(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
