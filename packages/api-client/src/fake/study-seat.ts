export const fakeStudySeatKey = "parfocal.fake.study-seat";

export function fakeStudySeat(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(fakeStudySeatKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export const takeFakeStudySeat = (code: string) =>
  globalThis.localStorage?.setItem(fakeStudySeatKey, code);
