import { useListSlideAreas } from "@parfocal/api-client";
import { useMemo } from "react";
import { okData } from "../screens/placeholder.tsx";
import { noAreas, type SlideAreaEntry, slideAreaEntries } from "./slide-areas.ts";

export type SlideAreasState = {
  readonly loaded: boolean;
  readonly areas: readonly SlideAreaEntry[];
};

export function useSlideAreas(slideId: string, enabled: boolean): SlideAreasState {
  const query = useListSlideAreas(slideId, { query: { enabled } });
  const rows = okData(query.data);
  const areas = useMemo(() => (rows ? slideAreaEntries(rows) : noAreas), [rows]);
  if (!enabled) return { loaded: true, areas: noAreas };
  return { loaded: rows !== undefined || query.isError, areas };
}
