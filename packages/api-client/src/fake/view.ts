import { type PersonKey, signedInAs } from "./scenario.ts";

export type FakeView = {
  viewer: PersonKey;
  firstWeek: boolean;
};

export const defaultFakeView: FakeView = { viewer: signedInAs, firstWeek: false };

let current: FakeView = defaultFakeView;

export function fakeView(): FakeView {
  return current;
}

export function setFakeView(next: FakeView): boolean {
  if (next.viewer === current.viewer && next.firstWeek === current.firstWeek) return false;
  current = next;
  return true;
}
