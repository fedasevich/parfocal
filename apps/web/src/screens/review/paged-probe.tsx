import type { PagedProbe } from "./paged-review.ts";

export function PagedProbeMarker({ probe }: { probe: PagedProbe }) {
  return (
    <div
      hidden
      data-testid="paged-review"
      data-ready={probe.ready}
      data-cells={probe.cells}
      data-paged={probe.paged}
      data-resident={probe.resident}
      data-drawn={probe.drawn}
      data-distinct-alphas={probe.distinctAlphas}
      data-working-set={probe.workingSet}
      data-indexed={probe.indexed}
      data-fields={probe.fields}
    />
  );
}
