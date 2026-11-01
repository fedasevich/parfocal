let fixed: Date | null = null;

export function now(): Date {
  return fixed === null ? new Date() : new Date(fixed);
}

export function fixClock(at: Date | null): void {
  fixed = at;
}
