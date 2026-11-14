export type Rgb = readonly [number, number, number];

export const visions = ["normal", "protanopia", "deuteranopia", "tritanopia"] as const;

export type Vision = (typeof visions)[number];

type Matrix = readonly [Rgb, Rgb, Rgb];

const machado: Record<Exclude<Vision, "normal">, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export const textLimits = { wcag: 4.5, apcaLc: 60 } as const;

export const graphicLimit = 3;

export const outlineLimit = { contrast: 3, maxUncoveredShare: 0.05 } as const;

export function parseHex(colour: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!match?.[1]) throw new Error(`Not a #rrggbb colour: ${colour}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function gamma(channel: number): number {
  const c = Math.min(1, Math.max(0, channel));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function wcagContrast(first: Rgb, second: Rgb): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

function apcaLuminance([r, g, b]: Rgb): number {
  const y =
    0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
  return y < 0.022 ? y + (0.022 - y) ** (1414 / 1000) : y;
}

export function apcaLc(text: Rgb, background: Rgb): number {
  const yText = apcaLuminance(text);
  const yBackground = apcaLuminance(background);
  if (Math.abs(yBackground - yText) < 0.0005) return 0;
  if (yBackground > yText) {
    const scaled = (yBackground ** 0.56 - yText ** 0.57) * 1.14;
    return scaled < 0.1 ? 0 : (scaled - 0.027) * 100;
  }
  const scaled = (yBackground ** 0.65 - yText ** 0.62) * 1.14;
  return scaled > -0.1 ? 0 : Math.abs((scaled + 0.027) * 100);
}

export function simulate(rgb: Rgb, vision: Vision): Rgb {
  if (vision === "normal") return rgb;
  const lin = rgb.map(linear) as [number, number, number];
  const channels = machado[vision].map((row) =>
    Math.round(gamma(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])),
  );
  return channels as unknown as Rgb;
}

function lab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(linear) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function hueDegrees(b: number, a: number): number {
  if (a === 0 && b === 0) return 0;
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

export function ciede2000(first: Rgb, second: Rgb): number {
  const rad = Math.PI / 180;
  const [l1, a1, b1] = lab(first);
  const [l2, a2, b2] = lab(second);
  const cMean = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hp1 = hueDegrees(b1, ap1);
  const hp2 = hueDegrees(b2, ap2);
  const dl = l2 - l1;
  const dc = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dHue = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lMean = (l1 + l2) / 2;
  const cpMean = (cp1 + cp2) / 2;
  let hMean = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hMean += hMean < 360 ? 360 : -360;
    hMean /= 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hMean - 30) * rad) +
    0.24 * Math.cos(2 * hMean * rad) +
    0.32 * Math.cos((3 * hMean + 6) * rad) -
    0.2 * Math.cos((4 * hMean - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sc = 1 + 0.045 * cpMean;
  const sh = 1 + 0.015 * cpMean * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt(
    (dl / sl) ** 2 + (dc / sc) ** 2 + (dHue / sh) ** 2 + rt * (dc / sc) * (dHue / sh),
  );
}

export interface Separation {
  distance: number;
  vision: Vision;
}

export function separation(first: string, second: string): Separation {
  const a = parseHex(first);
  const b = parseHex(second);
  let best: Separation | undefined;
  for (const vision of visions) {
    const distance = ciede2000(simulate(a, vision), simulate(b, vision));
    if (!best || distance < best.distance) best = { distance, vision };
  }
  return best as Separation;
}

export interface ReservedMark {
  label: string;
  colour: string;
  minDistance: number;
}

export interface ColourLimits {
  betweenClasses: number;
  reserved: readonly ReservedMark[];
}

export interface CheckInput {
  themes: Record<"dark" | "light", Record<string, string>>;
  classes: Record<string, string>;
  proposal: string;
  proposalCasing: string;
  limits: ColourLimits;
  pixels: readonly Rgb[];
}

export interface Finding {
  group: "text" | "graphic" | "classes" | "marks" | "outline" | "limits";
  name: string;
  value: number;
  limit: number;
  pass: boolean;
}

const textPairs = [
  ["body", "fg", "chrome"],
  ["secondary", "fg-dim", "chrome"],
  ["labels", "fg-faint", "chrome"],
  ["accent and links", "accent", "chrome"],
  ["on the primary button", "on-accent", "accent-fill"],
  ["firm, green", "ok", "chrome"],
  ["open, amber", "warn", "chrome"],
  ["error, red", "bad", "chrome"],
  ["body on the raised card", "fg", "chrome-2"],
  ["labels on the raised card", "fg-faint", "chrome-2"],
  ["unsure colour as text on the raised card", "unsure", "chrome-2"],
] as const;

const graphicPairs = [
  ["control border on the panel", "line-strong", "chrome"],
  ["control border on the raised card", "line-strong", "chrome-2"],
  ["unsure stripe on the bar track", "unsure", "chrome-3"],
  ["unsure stripe on the raised card", "unsure", "chrome-2"],
  ["checked segment on the bar track", "fg", "chrome-3"],
] as const;

export const reservedTokens = {
  "unsure zones on the slide": (input: CheckInput) => input.proposalCasing,
  "AI proposals": (input: CheckInput) => input.proposal,
  "unsure marks in the dark panel": (input: CheckInput) => input.themes.dark.unsure,
  "unsure marks in the light panel": (input: CheckInput) => input.themes.light.unsure,
} as const;

function token(input: CheckInput, theme: "dark" | "light", name: string): string {
  const value = input.themes[theme][name];
  if (!value) throw new Error(`Token --${name} has no plain #rrggbb value in the ${theme} theme`);
  return value;
}

function nearestClass(input: CheckInput, colour: string): { name: string; distance: number } {
  let best = { name: "", distance: Number.POSITIVE_INFINITY };
  for (const [name, classColour] of Object.entries(input.classes)) {
    const { distance } = separation(colour, classColour);
    if (distance < best.distance) best = { name, distance };
  }
  return best;
}

export function closestClassPair(classes: Record<string, string>): {
  pair: string;
  distance: number;
  vision: Vision;
} {
  const names = Object.keys(classes);
  let best = { pair: "", distance: Number.POSITIVE_INFINITY, vision: "normal" as Vision };
  for (const [i, first] of names.entries()) {
    for (const second of names.slice(i + 1)) {
      const result = separation(classes[first] as string, classes[second] as string);
      if (result.distance < best.distance) {
        best = { pair: `${first} and ${second}`, ...result };
      }
    }
  }
  return best;
}

export function closestClassPairUnder(
  classes: Record<string, string>,
  vision: Vision,
): { pair: string; distance: number } {
  const names = Object.keys(classes);
  let best = { pair: "", distance: Number.POSITIVE_INFINITY };
  for (const [i, first] of names.entries()) {
    for (const second of names.slice(i + 1)) {
      const distance = ciede2000(
        simulate(parseHex(classes[first] as string), vision),
        simulate(parseHex(classes[second] as string), vision),
      );
      if (distance < best.distance) best = { pair: `${first} and ${second}`, distance };
    }
  }
  return best;
}

export function uncoveredShare(
  outline: string,
  casing: string,
  pixels: readonly Rgb[],
  withCasing: boolean,
): number {
  if (pixels.length === 0) return 0;
  const outlineRgb = parseHex(outline);
  const casingRgb = parseHex(casing);
  let uncovered = 0;
  for (const pixel of pixels) {
    if (wcagContrast(outlineRgb, pixel) >= outlineLimit.contrast) continue;
    if (withCasing && wcagContrast(casingRgb, pixel) >= outlineLimit.contrast) continue;
    uncovered += 1;
  }
  return uncovered / pixels.length;
}

export function check(input: CheckInput): Finding[] {
  const findings: Finding[] = [];
  for (const theme of ["dark", "light"] as const) {
    for (const [name, fg, bg] of textPairs) {
      const text = parseHex(token(input, theme, fg));
      const background = parseHex(token(input, theme, bg));
      findings.push({
        group: "text",
        name: `${name}, WCAG 2, ${theme}`,
        value: wcagContrast(text, background),
        limit: textLimits.wcag,
        pass: wcagContrast(text, background) >= textLimits.wcag,
      });
      findings.push({
        group: "text",
        name: `${name}, APCA Lc, ${theme}`,
        value: apcaLc(text, background),
        limit: textLimits.apcaLc,
        pass: apcaLc(text, background) >= textLimits.apcaLc,
      });
    }
    for (const [name, fg, bg] of graphicPairs) {
      const value = wcagContrast(
        parseHex(token(input, theme, fg)),
        parseHex(token(input, theme, bg)),
      );
      findings.push({
        group: "graphic",
        name: `${name}, ${theme}`,
        value,
        limit: graphicLimit,
        pass: value >= graphicLimit,
      });
    }
  }

  const pair = closestClassPair(input.classes);
  findings.push({
    group: "classes",
    name: `closest class pair, ${pair.pair}, ${pair.vision}`,
    value: pair.distance,
    limit: input.limits.betweenClasses,
    pass: pair.distance >= input.limits.betweenClasses,
  });

  for (const mark of input.limits.reserved) {
    const resolve = reservedTokens[mark.label as keyof typeof reservedTokens];
    if (!resolve) {
      findings.push({
        group: "limits",
        name: `API mark without a token: ${mark.label}`,
        value: 0,
        limit: 1,
        pass: false,
      });
      continue;
    }
    const colour = resolve(input);
    const sameAsApi = colour.toLowerCase() === mark.colour.toLowerCase();
    findings.push({
      group: "limits",
      name: `token for ${mark.label} equals the API colour ${mark.colour}`,
      value: sameAsApi ? 1 : 0,
      limit: 1,
      pass: sameAsApi,
    });
    const nearest = nearestClass(input, colour);
    findings.push({
      group: "marks",
      name: `${mark.label}, nearest class ${nearest.name}`,
      value: nearest.distance,
      limit: mark.minDistance,
      pass: nearest.distance >= mark.minDistance,
    });
  }

  const outlines: Record<string, { colour: string; casing: string }> = {
    "AI proposal": { colour: input.proposal, casing: input.proposalCasing },
  };
  for (const [name, colour] of Object.entries(input.classes)) {
    outlines[`class ${name}`] = { colour, casing: input.proposal };
  }
  for (const [name, { colour, casing }] of Object.entries(outlines)) {
    const value = uncoveredShare(colour, casing, input.pixels, true);
    findings.push({
      group: "outline",
      name: `${name} outline with casing over sampled H&E pixels`,
      value,
      limit: outlineLimit.maxUncoveredShare,
      pass: input.pixels.length > 0 && value <= outlineLimit.maxUncoveredShare,
    });
  }
  return findings;
}

export function formatFindings(findings: readonly Finding[]): string {
  return findings
    .map(
      (f) =>
        `${f.pass ? "ok  " : "FAIL"} ${f.group.padEnd(8)} ${f.name}: ${f.value.toFixed(3)} (limit ${f.limit})`,
    )
    .join("\n");
}
