export const minutesPerSlide = 16;

export function slidePosition(position: number, slidesAssigned: number): number {
  return Math.min(Math.max(position + 1, 1), Math.max(slidesAssigned, 1));
}

export function minutesLeft(slidesSubmitted: number, slidesAssigned: number): number | null {
  if (slidesSubmitted <= 0) return null;
  const left = Math.max(slidesAssigned - slidesSubmitted, 0);
  return left * minutesPerSlide;
}
