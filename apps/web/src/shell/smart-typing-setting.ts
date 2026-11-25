import {
  getGetMySettingLayersQueryKey,
  type SettingValues,
  useSetMySettingLayers,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useResolvedSettings } from "./resolved-settings.ts";

export function useSavedAutoTyping(): [boolean, (next: boolean) => void] {
  const saved = useResolvedSettings()?.smart_auto_type;
  const [picked, setPicked] = useState<boolean | null>(null);
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const choose = useCallback(
    (next: boolean) => {
      setPicked(next);
      const values: Partial<SettingValues> = { smart_auto_type: next };
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
  return [picked ?? saved ?? true, choose];
}
