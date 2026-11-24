const one = (name: string) => {
  if (name === "main") return "main";
  if (name.startsWith("[")) return name;
  if (name.startsWith("#")) return `[data-testid="${name.slice(1)}"]`;
  return `[data-tour="${name}"]`;
};

export const anchorSelector = (anchor: string) => anchor.split("|").map(one).join(",");
