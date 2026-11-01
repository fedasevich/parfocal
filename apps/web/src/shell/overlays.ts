import { useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";

export const personaKeys = ["LM", "AK", "SM", "JR", "TB", "PK", "HL", "MV", "DH"] as const;

export type PersonaKey = (typeof personaKeys)[number];

export const overlaySearch = z.object({
  open: z.enum(["notifications", "palette"]).optional(),
  find: z.string().optional(),
  as: z.enum(personaKeys).optional(),
});

export type Overlay = NonNullable<z.infer<typeof overlaySearch>["open"]>;

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
