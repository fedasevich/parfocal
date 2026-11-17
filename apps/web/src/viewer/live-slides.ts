export type LiveSlideRow = {
  readonly id: string;
  readonly label: string;
  readonly case_id: string | null;
  readonly status: string;
  readonly result_sets: readonly unknown[];
};

export type LiveSlideScope = "task" | "case" | "project";

export type LiveSlideList = {
  readonly scope: LiveSlideScope;
  readonly slides: readonly LiveSlideRow[];
  readonly position: number;
  readonly total: number;
};

export function liveSlideList(input: {
  readonly slideId: string;
  readonly slides: readonly LiveSlideRow[];
  readonly taskSlideIds: readonly string[] | undefined;
  readonly caseSlideIds: readonly string[] | undefined;
}): LiveSlideList {
  const byId = new Map(input.slides.map((slide) => [slide.id, slide]));
  const pick = (ids: readonly string[]) =>
    ids.map(
      (id, index): LiveSlideRow =>
        byId.get(id) ?? {
          id,
          label: `Slide ${index + 1}`,
          case_id: null,
          status: "",
          result_sets: [],
        },
    );
  const scoped: [LiveSlideScope, readonly LiveSlideRow[]] =
    input.taskSlideIds !== undefined && input.taskSlideIds.length > 0
      ? ["task", pick(input.taskSlideIds)]
      : input.caseSlideIds !== undefined && input.caseSlideIds.length > 0
        ? ["case", pick(input.caseSlideIds)]
        : ["project", input.slides];
  const [scope, slides] = scoped;
  const index = slides.findIndex((slide) => slide.id === input.slideId);
  return { scope, slides, position: index + 1, total: slides.length };
}

export function withNeighbours(
  list: LiveSlideList,
  neighbours: { readonly position: number; readonly total: number } | undefined,
): LiveSlideList {
  if (neighbours === undefined || list.scope === "case" || neighbours.total === 0) return list;
  return { ...list, position: neighbours.position, total: neighbours.total };
}
