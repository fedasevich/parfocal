import { getGetMySettingLayersQueryKey, useSetMySettingLayers } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useResolvedSettings } from "../../shell/resolved-settings.ts";
import type { CornerChoice } from "./minimap-placement.ts";

export type MinimapSurface = "viewer" | "cells";

const keyOf = { viewer: "minimap_corner", cells: "minimap_corner_cells" } as const;

export type CornerChoiceUpdate = CornerChoice | ((current: CornerChoice) => CornerChoice);

export function useMinimapCorner(
  surface: MinimapSurface,
): [CornerChoice, (choice: CornerChoiceUpdate) => void] {
  const key = keyOf[surface];
  const choice = useResolvedSettings()?.[key] ?? "auto";
  const latest = useRef(choice);
  latest.current = choice;
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const update = useCallback(
    (next: CornerChoiceUpdate) => {
      const value = typeof next === "function" ? next(latest.current) : next;
      latest.current = value;
      queryClient.setQueryData(getGetMySettingLayersQueryKey(), (old: unknown) => {
        const response = old as { status: number; data: { personal: object } } | undefined;
        if (response?.status !== 200) return old;
        return {
          ...response,
          data: { ...response.data, personal: { ...response.data.personal, [key]: value } },
        };
      });
      mutate({ data: { values: { [key]: value } } });
    },
    [mutate, queryClient, key],
  );
  return [choice, update];
}
