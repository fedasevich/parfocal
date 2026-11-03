export const avatarColours = [
  "#2563eb",
  "#6d28d9",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#64748b",
  "#be185d",
  "#0369a1",
  "#0891b2",
] as const;

export function avatarColour(index: number): string {
  const count = avatarColours.length;
  const whole = Number.isFinite(index) ? Math.trunc(index) : 0;
  return avatarColours[((whole % count) + count) % count] ?? avatarColours[0];
}

export type PersonInfo = {
  initials: string;
  name: string;
  color: string;
  role?: string;
};

export type AvatarProfile = {
  display_name: string;
  initials: string;
  avatar_colour: number | null | undefined;
  title?: string | null | undefined;
};

export function personFromProfile(profile: AvatarProfile): PersonInfo {
  return {
    name: profile.display_name,
    initials: profile.initials,
    color: avatarColour(profile.avatar_colour ?? 0),
    ...(profile.title ? { role: profile.title } : {}),
  };
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return 0;
  const [r, g, b] = match.slice(1).map((part) => channel(Number.parseInt(part, 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableOn(background: string): "#ffffff" | "#0b0b0b" {
  return contrast(background, "#ffffff") >= contrast(background, "#0b0b0b") ? "#ffffff" : "#0b0b0b";
}
