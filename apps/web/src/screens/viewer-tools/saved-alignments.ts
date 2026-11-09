import {
  type CompareAlignment,
  getGetMySettingLayersQueryKey,
  useGetMySettingLayers,
  useSetMySettingLayers,
} from "@parfocal/api-client";
import type { ViewOffset } from "@parfocal/viewer-engine";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

export type SavedAlignments = Readonly<Record<string, CompareAlignment>>;

export const pairKeyOf = (left: string | undefined, right: string | undefined): string | null =>
  left === undefined || right === undefined ? null : `${left}:${right}`;

const offsetOf = ({ x, y, zoom, rotation }: CompareAlignment): ViewOffset => ({
  x,
  y,
  zoom,
  rotation,
});

export const sameOffset = (a: ViewOffset, b: ViewOffset): boolean =>
  a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.rotation === b.rotation;

export function savedOffsetOf(saved: SavedAlignments, pair: string): ViewOffset | null {
  const found = saved[pair];
  return found === undefined ? null : offsetOf(found);
}

function alignmentsIn(personal: object | undefined): SavedAlignments {
  const stored = (personal as Record<string, unknown> | undefined)?.["compare_alignments"];
  return typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? (stored as SavedAlignments)
    : {};
}

export function useSavedAlignments(): {
  ready: boolean;
  saved: SavedAlignments;
  save: (pair: string, offset: ViewOffset | null) => void;
} {
  const response = useGetMySettingLayers().data;
  const ready = response?.status === 200;
  const saved = ready ? alignmentsIn(response.data.personal) : {};
  const latest = useRef(saved);
  latest.current = saved;
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const save = useCallback(
    (pair: string, offset: ViewOffset | null) => {
      const current = latest.current[pair];
      if (
        offset === null ? current === undefined : current && sameOffset(offsetOf(current), offset)
      )
        return;
      const { [pair]: _dropped, ...others } = latest.current;
      const next: SavedAlignments = offset === null ? others : { ...others, [pair]: offset };
      latest.current = next;
      const value = Object.keys(next).length === 0 ? null : next;
      queryClient.setQueryData(getGetMySettingLayersQueryKey(), (old: unknown) => {
        const cached = old as { status: number; data: { personal: object } } | undefined;
        if (cached?.status !== 200) return old;
        const { compare_alignments: _gone, ...rest } = cached.data.personal as Record<
          string,
          unknown
        >;
        const personal = value === null ? rest : { ...rest, compare_alignments: value };
        return { ...cached, data: { ...cached.data, personal } };
      });
      mutate({ data: { values: { compare_alignments: value } } });
    },
    [mutate, queryClient],
  );
  return { ready, saved, save };
}
