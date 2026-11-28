import type { ProjectModel, SlideEstimate } from "@parfocal/api-client";
import { formatClock } from "../format.ts";
import type { RunEstimate } from "./model.ts";

type KnownEstimate = SlideEstimate & { minutes: number; dollars: number };

const isKnown = (item: SlideEstimate): item is KnownEstimate =>
  item.minutes !== null && item.dollars !== null;

const dollars = (amount: number) => `$${amount.toFixed(2)}`;

export function projectedEstimate(
  model: ProjectModel,
  count: number,
  estimates: SlideEstimate[] | undefined,
  now: Date,
  queue: string,
): RunEstimate {
  const known = (estimates ?? []).filter(isKnown);
  if (count === 0 || known.length < count) {
    return {
      total: null,
      doneAround: null,
      cost: null,
      perSlide: `${model.title} takes as long as the slide has tissue. Time and cost show once the tissue of each picked slide is measured.`,
    };
  }
  const minutes = known.map((item) => item.minutes);
  const total = minutes.reduce((sum, value) => sum + value, 0);
  const least = Math.min(...minutes);
  const most = Math.max(...minutes);
  const range = least === most ? `${least}` : `${least} to ${most}`;
  const projected = known.some((item) => item.projected);
  const basis = projected
    ? "Projected from the slide's tissue area at the rate of the one L4 run measured so far."
    : "From earlier runs of this model.";
  const assumed = known.find((item) => item.assumed_mpp != null)?.assumed_mpp;
  const scale =
    assumed == null ? "" : ` A slide that states no scale is taken as ${assumed} µm per pixel.`;
  const wait = model.queue_minutes + model.start_minutes;
  return {
    total: total + model.start_minutes,
    doneAround: formatClock(new Date(now.getTime() + (total + wait) * 60000)),
    cost: dollars(known.reduce((sum, item) => sum + item.dollars, 0)),
    perSlide: `About ${range} min a slide on the ${model.server}. ${queue} ${basis}${scale}`,
  };
}
