type ReviewedShare = { reviewed: number; slides: number };

export function reviewedShare(overview: {
  slides: number;
  reviewed_slides: number;
}): ReviewedShare | null {
  if (overview.slides <= 0) return null;
  return { reviewed: Math.min(overview.reviewed_slides, overview.slides), slides: overview.slides };
}

export function reviewedShareText({ reviewed, slides }: ReviewedShare): string {
  return `${reviewed} of ${slides} ${slides === 1 ? "slide" : "slides"} reviewed`;
}
