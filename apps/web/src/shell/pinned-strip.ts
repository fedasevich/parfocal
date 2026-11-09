import { getGetMySettingLayersQueryKey, useSetMySettingLayers } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useResolvedSettings } from "./resolved-settings.ts";

export function usePinnedStrip(): [boolean, (value: boolean) => void] {
  const pinned = useResolvedSettings()?.slide_strip === true;
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const update = useCallback(
    (value: boolean) => {
      queryClient.setQueryData(getGetMySettingLayersQueryKey(), (old: unknown) => {
        const response = old as { status: number; data: { personal: object } } | undefined;
        if (response?.status !== 200) return old;
        return {
          ...response,
          data: {
            ...response.data,
            personal: { ...response.data.personal, slide_strip: value },
          },
        };
      });
      mutate({ data: { values: { slide_strip: value } } });
    },
    [mutate, queryClient],
  );
  return [pinned, update];
}
