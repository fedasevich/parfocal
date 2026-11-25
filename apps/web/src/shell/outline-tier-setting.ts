import {
  getGetMySettingLayersQueryKey,
  type SettingValues,
  useSetMySettingLayers,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { startingTier } from "../aiseg/one-click-tiers.ts";
import type { OutlineTier } from "../aiseg/prompt-fallback.ts";
import { useResolvedSettings } from "./resolved-settings.ts";

export function useSavedOutlineTier(): [OutlineTier, (next: OutlineTier) => void] {
  const saved = useResolvedSettings()?.tier_outline;
  const [picked, setPicked] = useState<OutlineTier | null>(null);
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const choose = useCallback(
    (next: OutlineTier) => {
      setPicked(next);
      const values: Partial<SettingValues> = { tier_outline: next };
      queryClient.setQueryData(getGetMySettingLayersQueryKey(), (old: unknown) => {
        const response = old as { status: number; data: { personal: object } } | undefined;
        if (response?.status !== 200) return old;
        return {
          ...response,
          data: { ...response.data, personal: { ...response.data.personal, ...values } },
        };
      });
      mutate({ data: { values } });
    },
    [mutate, queryClient],
  );
  return [picked ?? startingTier(saved), choose];
}
