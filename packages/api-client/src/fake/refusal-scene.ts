const refusals = {
  "not-assigned": { status: 403, title: "Only the reviewer assigned to this slide does that" },
  "unknown-object": { status: 404, title: "This object is not in this result set" },
} as const;

type FakeRefusal = keyof typeof refusals;

let refusing: FakeRefusal | null = null;

const isRefusal = (value: unknown): value is FakeRefusal =>
  typeof value === "string" && Object.hasOwn(refusals, value);

export function setFakeRefusal(next: unknown): void {
  refusing = isRefusal(next) ? next : null;
}

export function fakeRefusal(): { code: string; status: number; title: string } | null {
  return refusing === null ? null : { code: refusing, ...refusals[refusing] };
}
