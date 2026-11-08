type FilterableSlide = {
  label: string;
  file: string;
  stain: string;
  case_label: string | null;
  result_sets: { id: string }[];
  reviews: { state: string }[];
};

export type SlideFilters = {
  query: string;
  resultSetId: string;
  needsReview: boolean;
  noResults: boolean;
};

export const noFilters: SlideFilters = {
  query: "",
  resultSetId: "any",
  needsReview: false,
  noResults: false,
};

export const hasOpenReview = (slide: Pick<FilterableSlide, "reviews">) =>
  slide.reviews.some((review) => review.state !== "submitted");

export function matchesFilters(slide: FilterableSlide, filters: SlideFilters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const text = [slide.label, slide.file, slide.stain, slide.case_label ?? ""]
      .join(" ")
      .toLowerCase();
    if (!text.includes(query)) return false;
  }
  if (
    filters.resultSetId !== "any" &&
    !slide.result_sets.some((set) => set.id === filters.resultSetId)
  ) {
    return false;
  }
  if (filters.needsReview && !hasOpenReview(slide)) return false;
  if (filters.noResults && slide.result_sets.length > 0) return false;
  return true;
}

export const isFiltering = (filters: SlideFilters) =>
  filters.query.trim() !== "" ||
  filters.resultSetId !== "any" ||
  filters.needsReview ||
  filters.noResults;
