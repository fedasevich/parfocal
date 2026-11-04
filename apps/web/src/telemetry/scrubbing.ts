export const redacted = "[redacted]";

export const allowedFields: ReadonlySet<string> = new Set([
  "request_id",
  "trace_id",
  "span_id",
  "tenant_id",
  "user_id",
  "case_id",
  "slide_id",
  "study_id",
  "job_id",
  "event",
  "action",
  "method",
  "route",
  "status_code",
  "duration_ms",
  "error_type",
  "error_code",
  "environment",
  "service",
  "release",
  "count",
  "size_bytes",
]);

const minimumSensitiveLength = 3;

const fixedPatterns: readonly RegExp[] = [
  /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu,
  /\bBearer\s+[\w.~+/=-]+/giu,
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const phrasePattern = (value: string) =>
  value.split(" ").map(escapeRegExp).join("(?:\\s|%20|\\+)+");

const normalise = (value: string) => value.split(/\s+/u).filter(Boolean).join(" ").toLowerCase();

export class SensitiveValues {
  #values = new Set<string>();
  #pattern: RegExp | null = null;

  register(...values: readonly (string | null | undefined)[]): void {
    let changed = false;
    for (const value of values) {
      if (typeof value !== "string") continue;
      const kept = normalise(value);
      if (kept.length < minimumSensitiveLength || this.#values.has(kept)) continue;
      this.#values.add(kept);
      changed = true;
    }
    if (changed) this.#compile();
  }

  clear(): void {
    this.#values.clear();
    this.#pattern = null;
  }

  redact(text: string): string {
    let result = this.#pattern === null ? text : text.replace(this.#pattern, redacted);
    for (const pattern of fixedPatterns) result = result.replace(pattern, redacted);
    return result;
  }

  #compile(): void {
    const ordered = [...this.#values].sort((first, second) => second.length - first.length);
    this.#pattern = new RegExp(ordered.map(phrasePattern).join("|"), "giu");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function redactTree(value: unknown, sensitive: SensitiveValues): unknown {
  if (typeof value === "string") return sensitive.redact(value);
  if (Array.isArray(value)) return value.map((item) => redactTree(item, sensitive));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactTree(item, sensitive)]),
    );
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return typeof value === "bigint" ? value.toString() : redacted;
}

export function scrubFields(
  fields: Readonly<Record<string, unknown>>,
  sensitive: SensitiveValues,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      allowedFields.has(key) ? redactTree(value, sensitive) : redacted,
    ]),
  );
}

export function scrubUrl(url: string, sensitive: SensitiveValues): string {
  const cut = url.search(/[?#]/u);
  return sensitive.redact(cut === -1 ? url : url.slice(0, cut));
}

export class ScrubbedError extends Error {
  constructor(name: string, message: string, stack: string | undefined) {
    super(message);
    this.name = name;
    if (stack !== undefined) this.stack = stack;
  }
}

export function scrubError(error: unknown, sensitive: SensitiveValues): ScrubbedError {
  if (error instanceof Error) {
    const stack = error.stack === undefined ? undefined : sensitive.redact(error.stack);
    return new ScrubbedError(error.name, sensitive.redact(error.message), stack);
  }
  return new ScrubbedError("NonError", sensitive.redact(String(error)), undefined);
}
