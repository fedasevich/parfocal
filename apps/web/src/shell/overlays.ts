import { useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { settingsSectionKeys } from "../screens/settings/sections.ts";
import { lenientSearch } from "../search/lenient-search.ts";

export const personaKeys = ["LM", "AK", "SM", "JR", "TB", "PK", "HL", "MV", "DH"] as const;

export type PersonaKey = (typeof personaKeys)[number];

export const overlaySearch = lenientSearch({
  open: z.enum(["notifications", "palette"]).optional(),
  settings: z.enum(settingsSectionKeys).optional(),
  find: z.string().optional(),
  as: z.enum(personaKeys).optional(),
});

export type Overlay = NonNullable<ReturnType<typeof overlaySearch.read>["open"]>;

export function useOverlay() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const open = search.open;
  const set = (next: Overlay | undefined, find?: string) =>
    navigate({
      to: ".",
      replace: true,
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        open: next,
        find: next === "palette" ? find : undefined,
      }),
    });
  return { open, find: search.find, set };
}
