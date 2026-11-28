import { Trans, useLingui } from "@lingui/react/macro";
import { Icon } from "@parfocal/ui/components/icon";
import { useDocked } from "../viewer/inspector-slots.tsx";
import { deviceNames, type LegendContext, type LegendDevice, legendRows } from "./device-legend.ts";
import { useLegendFold } from "./legend-fold.ts";

const foldButton =
  "grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-fg-faint hover:bg-chrome-2 hover:text-fg";

export function DeviceLegend({
  device,
  context,
}: {
  device: LegendDevice;
  context: LegendContext;
}) {
  const { t } = useLingui();
  const docked = useDocked();
  const [fold, setFold] = useLegendFold();

  if (fold === "hidden") {
    return (
      <button
        type="button"
        data-testid="device-legend-show"
        onClick={() => setFold("open")}
        className={
          docked
            ? "cursor-pointer justify-self-start rounded-ctl border border-surf-edge bg-surf-section px-2.5 py-1 text-caption text-fg-dim hover:text-fg"
            : "absolute top-4 left-4 z-10 cursor-pointer rounded-ctl border border-line bg-chrome px-2.5 py-1 text-caption text-fg-dim shadow-lg hover:text-fg"
        }
      >
        <Trans>Show input help</Trans>
      </button>
    );
  }

  const collapsed = fold === "collapsed";
  return (
    <section
      aria-label={t`${deviceNames[device]} controls`}
      data-testid="device-legend"
      data-device={device}
      data-context={context}
      data-fold={fold}
      className={
        docked
          ? "grid gap-2.5 rounded-zone border border-surf-edge bg-surf-section p-3 text-body-sm"
          : "absolute top-4 left-4 z-10 grid w-64 gap-2.5 rounded-zone border border-line bg-chrome p-4 text-body-sm shadow-lg"
      }
    >
      <div className="flex items-center gap-2 font-semibold text-body">
        <Icon name={device === "footswitch" ? "keyboard" : device} size="md" />
        <span>{deviceNames[device]}</span>
        <span className="ml-auto rounded-full bg-chrome-2 px-2 py-0.5 font-medium text-caption text-fg-dim capitalize">
          {context}
        </span>
        <button
          type="button"
          data-testid="device-legend-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t`Expand the input help` : t`Collapse the input help`}
          onClick={() => setFold(collapsed ? "open" : "collapsed")}
          className={foldButton}
        >
          <Icon name="caret" className={collapsed ? "" : "rotate-90"} />
        </button>
        <button
          type="button"
          data-testid="device-legend-hide"
          aria-label={t`Hide the input help`}
          title={t`Hide the input help`}
          onClick={() => setFold("hidden")}
          className={foldButton}
        >
          <Icon name="close" />
        </button>
      </div>
      {collapsed
        ? null
        : legendRows[device][context].map(([action, control]) => (
            <div key={action} className="grid grid-cols-[82px_1fr] gap-2 text-fg-dim">
              <span>{action}</span>
              <b className="font-medium text-fg">{control}</b>
            </div>
          ))}
    </section>
  );
}
