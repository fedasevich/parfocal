const browsers: readonly [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const systems: readonly [RegExp, string][] = [
  [/iPhone|iPad|iOS/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "Mac"],
  [/Linux|X11/, "Linux"],
];

export function deviceName(userAgent: string | null | undefined): string {
  const agent = userAgent?.trim() ?? "";
  if (agent === "") return "unknown device";
  const browser = browsers.find(([pattern]) => pattern.test(agent))?.[1];
  const system = systems.find(([pattern]) => pattern.test(agent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return `${browser} browser`;
  if (system) return `${system} device`;
  return "unnamed client";
}
