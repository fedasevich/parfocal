import { Trans, useLingui } from "@lingui/react/macro";
import { AreaList } from "@parfocal/ui/components/analysis-cards";
import { useEffect, useMemo } from "react";
import { areaRoleText, areaRows } from "../screens/viewer/area-nav.ts";
import { DockCard, dockedCard, useDocked } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { areasUnsized, rankSize, type SlideAreaEntry } from "./slide-areas.ts";
import { TravelMinimap } from "./travel-minimap.tsx";
import { useEngineAreaNav } from "./use-engine-area-nav.ts";
import type { ViewerEngine } from "./viewer-engine.ts";
import type { SelectionArea } from "./viewer-keys.ts";

export function AreaKeys({
  session,
  areas,
  host,
  focused,
  listed = true,
}: {
  session: { readonly engine: ViewerEngine; readonly module: ViewerModule };
  areas: readonly SlideAreaEntry[];
  host: HTMLElement | null;
  focused: { current: SelectionArea | null };
  listed?: boolean;
}) {
  const { t } = useLingui();
  const docked = useDocked();
  const nav = useEngineAreaNav(session.engine, session.module, areas, host);
  useEffect(() => {
    focused.current = areas.find((entry) => entry.object === nav.current)?.bounds ?? null;
    return () => {
      focused.current = null;
    };
  }, [focused, areas, nav.current]);
  const unsized = areasUnsized(areas);
  const ranked = useMemo(
    () => areas.map((entry) => ({ object: entry.object, size: rankSize(entry) })),
    [areas],
  );
  const rows = useMemo(() => areaRows(ranked, () => undefined), [ranked]);
  const roles = useMemo(
    () =>
      new Map(
        rows.map((row) => [row.object, row.role && !unsized ? areaRoleText[row.role] : undefined]),
      ),
    [rows, unsized],
  );
  if (areas.length === 0) return null;
  const targetRow = rows.find((row) => row.object === nav.travelling?.object);
  return (
    <>
      {nav.travelling ? (
        <TravelMinimap
          engine={session.engine}
          travel={nav.travelling}
          label={`area ${targetRow?.number ?? ""}`.trim()}
          host={host}
        />
      ) : null}
      {listed ? (
        <DockCard section="objects" order={2}>
          <section
            aria-label={t`Areas`}
            data-testid="area-nav"
            data-current={nav.current ?? ""}
            data-visited={[...nav.visited].sort().join(" ")}
            className={
              docked
                ? dockedCard
                : "absolute top-4 right-4 grid w-[min(320px,calc(100%-6rem))] gap-2 rounded-ctl border border-line bg-chrome p-3"
            }
          >
            <h2 className="m-0 font-semibold text-body-sm">
              <Trans>Areas, largest first</Trans>
            </h2>
            {unsized ? (
              <p data-testid="area-sizes-unknown" className="m-0 text-caption text-fg-dim">
                <Trans>
                  This slide has no pixel size, so areas show in pixels and get no size category.
                </Trans>
              </p>
            ) : null}
            <AreaList
              areas={ranked}
              sizesInPixels={unsized}
              current={nav.current}
              visited={nav.visited}
              roleOf={(object) => roles.get(object)}
              onGoTo={nav.goTo}
              className={docked ? "max-h-none overflow-visible" : undefined}
            />
          </section>
        </DockCard>
      ) : null}
      <span
        hidden
        data-testid="area-visits"
        data-current={nav.current ?? ""}
        data-visited={[...nav.visited].sort().join(" ")}
      />
    </>
  );
}
