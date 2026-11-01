import { defaultFakeView, type FakeView } from "@parfocal/api-client/fake";

export function fakeViewFor(pathname: string, search: Record<string, unknown>): FakeView {
  if (pathname === "/" && search["scene"] === "new") return { viewer: "LM", firstWeek: true };
  if (pathname === "/my-work") {
    if (search["scene"] === "anna") return { viewer: "AK", firstWeek: false };
    const tab = search["tab"] ?? search["scene"];
    if (tab === "assigned") return { viewer: "DH", firstWeek: false };
  }
  return defaultFakeView;
}
