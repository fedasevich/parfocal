import { minutesPerSlide } from "../my-work/review-progress.ts";

export function slidesTimeLeft(position: number, total: number): string {
  const minutes = Math.max(total - position + 1, 0) * minutesPerSlide;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `about ${rest} min left`;
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`;
}
