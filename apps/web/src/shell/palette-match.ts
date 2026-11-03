export type Match = { score: number; indices: number[] };

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const isWordStart = (text: string, index: number) =>
  index === 0 || !/[\p{L}\p{N}]/u.test(text.charAt(index - 1));

function matchToken(text: string, token: string, loose: boolean): Match | null {
  const at = text.indexOf(token);
  if (at >= 0) {
    const indices = Array.from({ length: token.length }, (_, offset) => at + offset);
    const start = isWordStart(text, at) ? 40 : 0;
    const whole = text === token ? 60 : 0;
    return { score: 100 + token.length * 4 + start + whole - at * 0.5, indices };
  }
  if (!loose || token.length < 3) return null;
  const indices: number[] = [];
  let from = 0;
  let score = 0;
  for (const char of token) {
    let found = -1;
    for (let index = from; index < text.length; index++) {
      if (found >= 0 && index > found + 10) break;
      if (text.charAt(index) === char && (isWordStart(text, index) || found < 0)) {
        found = index;
        if (isWordStart(text, index)) break;
      }
    }
    if (found < 0) return null;
    const previous = indices[indices.length - 1];
    const joined = previous !== undefined && found === previous + 1;
    score += 4 + (joined ? 6 : 0) + (isWordStart(text, found) ? 8 : 0);
    if (previous !== undefined && !joined) score -= Math.min(6, found - previous - 1);
    indices.push(found);
    from = found + 1;
  }
  const spread = (indices[indices.length - 1] ?? 0) - (indices[0] ?? 0) + 1;
  if (spread > token.length * 2 + 2) return null;
  return { score, indices };
}

export function matchText(text: string, query: string, loose = true): Match | null {
  const folded = fold(text);
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, indices: [] };
  let score = 0;
  const indices = new Set<number>();
  for (const token of tokens) {
    const found = matchToken(folded, token, loose);
    if (found === null) return null;
    score += found.score;
    for (const index of found.indices) indices.add(index);
  }
  return { score, indices: [...indices].sort((a, b) => a - b) };
}

export function matchCommand(
  label: string,
  keywords: readonly string[],
  query: string,
): Match | null {
  const direct = matchText(label, query);
  if (direct !== null) return direct;
  let best: Match | null = null;
  for (const keyword of keywords) {
    const found = matchText(keyword, query, false);
    if (found !== null && (best === null || found.score > best.score)) {
      best = { score: found.score * 0.5, indices: [] };
    }
  }
  return best;
}
