import {
  getGetMySettingLayersQueryKey,
  type SettingValues,
  useSetMySettingLayers,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { useResolvedSettings } from "../../shell/resolved-settings.ts";

export const inspectorDefaultWidth = 340;
export const inspectorMinWidth = 280;
export const inspectorMaxWidth = 560;
export const inspectorHideBelow = 220;

export type InspectorLayout = { width: number; hidden: boolean; hideWhilePanning: boolean };

type PanelSettings = Pick<
  SettingValues,
  "side_panel_width" | "hide_side_panel" | "panel_while_moving"
>;

export const defaultInspectorLayout: InspectorLayout = {
  width: inspectorDefaultWidth,
  hidden: false,
  hideWhilePanning: false,
};

export function clampInspectorWidth(width: number): number {
  return Math.min(inspectorMaxWidth, Math.max(inspectorMinWidth, Math.round(width)));
}

export function dragInspector(width: number): { width: number; hidden: boolean } {
  if (width < inspectorHideBelow) return { width: inspectorMinWidth, hidden: true };
  return { width: clampInspectorWidth(width), hidden: false };
}

export function layoutOfSettings(values: PanelSettings): InspectorLayout {
  return {
    width: clampInspectorWidth(values.side_panel_width),
    hidden: values.hide_side_panel,
    hideWhilePanning: values.panel_while_moving === "auto",
  };
}

export function settingsOfLayoutPatch(patch: Partial<InspectorLayout>): Partial<PanelSettings> {
  return {
    ...(patch.width === undefined ? {} : { side_panel_width: clampInspectorWidth(patch.width) }),
    ...(patch.hidden === undefined ? {} : { hide_side_panel: patch.hidden }),
    ...(patch.hideWhilePanning === undefined
      ? {}
      : { panel_while_moving: patch.hideWhilePanning ? ("auto" as const) : ("pinned" as const) }),
  };
}

export type InspectorLayoutChange =
  | Partial<InspectorLayout>
  | ((current: InspectorLayout) => Partial<InspectorLayout>);

export function useInspectorLayout(): [InspectorLayout, (change: InspectorLayoutChange) => void] {
  const settings = useResolvedSettings();
  const queryClient = useQueryClient();
  const { mutate } = useSetMySettingLayers({
    mutation: {
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const layout = useMemo(
    () => (settings === undefined ? defaultInspectorLayout : layoutOfSettings(settings)),
    [settings],
  );
  const latest = useRef(layout);
  latest.current = layout;
  const update = useCallback(
    (change: InspectorLayoutChange) => {
      const patch = typeof change === "function" ? change(latest.current) : change;
      latest.current = { ...latest.current, ...patch };
      const values = settingsOfLayoutPatch(patch);
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
  return [layout, update];
}
