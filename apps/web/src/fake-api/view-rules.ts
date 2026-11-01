import { defaultFakeView, type FakeView, scenario } from "@parfocal/api-client/fake";

const isPersona = (value: unknown): value is keyof typeof scenario.people =>
  typeof value === "string" && Object.hasOwn(scenario.people, value);

export function fakeViewFor(pathname: string, search: Record<string, unknown>): FakeView {
  const persona = search["as"];
  if (isPersona(persona)) return { viewer: persona, firstWeek: false };
  if (pathname === "/" && search["scene"] === "new") return { viewer: "LM", firstWeek: true };
  if (pathname === "/my-work") {
    if (search["scene"] === "anna") return { viewer: "AK", firstWeek: false };
    const tab = search["tab"] ?? search["scene"];
    if (tab === "assigned") return { viewer: "DH", firstWeek: false };
  }
  if (pathname === "/team") return { viewer: "DH", firstWeek: false };
  if (
    pathname.endsWith("/report") &&
    (search["scene"] === "cosign" || search["scene"] === "sent")
  ) {
    return { viewer: "TB", firstWeek: false };
  }
  return defaultFakeView;
}
