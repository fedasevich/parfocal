import {
  getGetMySettingLayersQueryKey,
  type SettingValues,
  useSetMySettingLayers,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useSignedInArea } from "../session/signed-in-area.ts";
import {
  type OutlineModeChoice,
  outlineModeChoices,
  setOutlineMode,
  useOutlineMode,
} from "../viewer/outline-mode.ts";
import { useResolvedSettings } from "./resolved-settings.ts";

export function useAppliedOutlineMode(): void {
  const enabled = useSignedInArea();
  const mode = useResolvedSettings(enabled)?.outline_mode;
  useEffect(() => {
    const chosen = outlineModeChoices.find((choice) => choice === mode);
    if (chosen !== undefined) setOutlineMode(chosen);
  }, [mode]);
}

export function useSavedOutlineMode(): [OutlineModeChoice, (next: OutlineModeChoice) => void] {
  const [mode] = useOutlineMode();
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const choose = useCallback(
    (next: OutlineModeChoice) => {
      setOutlineMode(next);
      const values: Partial<SettingValues> = { outline_mode: next };
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
  return [mode, choose];
}
