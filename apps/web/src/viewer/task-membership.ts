export function slideOutsideTask(
  task: { slides: readonly { slide_id: string }[] } | undefined,
  slideId: string,
): boolean {
  return task !== undefined && !task.slides.some((slide) => slide.slide_id === slideId);
}
