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
  readonly previousId?: string | null;
  readonly nextId?: string | null;
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

export function stepLiveSlide(
  list: LiveSlideList,
  slideId: string,
  delta: 1 | -1,
): string | undefined {
  const known = delta === 1 ? list.nextId : list.previousId;
  if (known !== undefined) return known ?? undefined;
  const at = list.slides.findIndex((slide) => slide.id === slideId);
  return at < 0 ? undefined : list.slides[at + delta]?.id;
}

export type LiveDecisionSplit = {
  readonly agree: number;
  readonly disagree: number;
  readonly unsure: number;
  readonly open: number;
};

export function liveDecisionSplit(
  decisions: readonly { readonly value: string }[],
  objectTotal: number,
): LiveDecisionSplit & { readonly decided: number; readonly total: number } {
  const count = (value: string) => decisions.filter((item) => item.value === value).length;
  const agree = count("agree");
  const disagree = count("disagree");
  const unsure = count("unsure");
  const decided = agree + disagree + unsure;
  const total = Math.max(objectTotal, decided);
  return { agree, disagree, unsure, open: total - decided, decided, total };
}

const minutesPerSlide = 20;

export function timeLeftText(position: number, total: number): string {
  const minutes = Math.max(0, total - position) * minutesPerSlide;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `about ${rest} min`;
  return `about ${hours} h${rest ? ` ${rest} min` : ""}`;
}

export function withNeighbours(
  list: LiveSlideList,
  neighbours:
    | {
        readonly position: number;
        readonly total: number;
        readonly previous?: { readonly id: string } | null;
        readonly next?: { readonly id: string } | null;
      }
    | undefined,
): LiveSlideList {
  if (neighbours === undefined || list.scope === "case" || neighbours.total === 0) return list;
  return {
    ...list,
    position: neighbours.position,
    total: neighbours.total,
    previousId: neighbours.previous?.id ?? null,
    nextId: neighbours.next?.id ?? null,
  };
}
