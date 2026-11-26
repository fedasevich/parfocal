import { t } from "@lingui/core/macro";
import { lazyText } from "@parfocal/ui/lib/lazy-text";

export const resultFormatRows = lazyText((): [string, string][] => [
  ["Parfocal JSON", t`Regions, cells, classes, scores and IDs in one file. The native format.`],
  [
    t`GeoJSON or a QuPath export`,
    t`Polygons and points. QuPath classes and measurements are kept.`,
  ],
  [t`CSV or TSV`, t`One row per cell with x, y and a class.`],
  [
    t`Masks or heatmaps`,
    t`PNG or TIFF at one pyramid level. The level is checked with an overlay.`,
  ],
]);
