let withoutLabModels = false;

export function setFakeLabModelsAbsent(value: unknown): void {
  withoutLabModels = value === "none";
}

export function fakeLabModelsAbsent(): boolean {
  return withoutLabModels;
}
