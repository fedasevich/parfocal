import { Icon } from "@parfocal/ui/components/icon";
import { deviceNames, type LegendContext, type LegendDevice, legendRows } from "./device-legend.ts";

export function DeviceLegend({
  device,
  context,
}: {
  device: LegendDevice;
  context: LegendContext;
}) {
  return (
    <section
      aria-label={`${deviceNames[device]} controls`}
      data-testid="device-legend"
      data-device={device}
      data-context={context}
      className="absolute top-4 left-4 z-10 grid w-64 gap-2.5 rounded-zone border border-line bg-chrome p-4 text-body-sm shadow-lg"
    >
      <div className="flex items-center gap-2 font-semibold text-body">
        <Icon name={device} size="md" />
        <span>{deviceNames[device]}</span>
        <span className="ml-auto rounded-full bg-chrome-2 px-2 py-0.5 font-medium text-caption text-fg-dim capitalize">
          {context}
        </span>
      </div>
      {legendRows[device][context].map(([action, control]) => (
        <div key={action} className="grid grid-cols-[82px_1fr] gap-2 text-fg-dim">
          <span>{action}</span>
          <b className="font-medium text-fg">{control}</b>
        </div>
      ))}
    </section>
  );
}
