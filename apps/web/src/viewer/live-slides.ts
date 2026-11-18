import { submittedStates } from "../presence/blinded.ts";

export type LiveSlideRow = {
  readonly id: string;
  readonly label: string;
  readonly case_id: string | null;
  readonly status: string;
  readonly result_sets: readonly { readonly name: string }[];
  readonly reviews?: readonly { readonly task_id: string; readonly state: string }[];
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

export type LivePopoverRow = {
  readonly id: string;
  readonly name: string;
  readonly sub?: string;
  readonly resultSets: number;
  readonly current: boolean;
  readonly building: boolean;
  readonly status: { readonly label: string; readonly tone: "neutral" | "accent" | "ok" };
};

export type LiveSlideGroups = {
  readonly caseRows: readonly LivePopoverRow[];
  readonly looseRows: readonly LivePopoverRow[];
};

const buildingStates: ReadonlySet<string> = new Set(["uploaded", "ai-running"]);

const sentence = (status: string) => {
  const words = status.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function liveSlideGroups(input: {
  readonly slideId: string;
  readonly list: LiveSlideList;
  readonly slides: readonly LiveSlideRow[];
  readonly caseSlides:
    | readonly { readonly id: string; readonly label: string; readonly stain?: string }[]
    | undefined;
  readonly task: { readonly id: string; readonly slideIds: readonly string[] } | undefined;
  readonly currentSetNames?: readonly string[] | undefined;
}): LiveSlideGroups {
  const byId = new Map(
    [...input.list.slides, ...input.slides].map((slide): [string, LiveSlideRow] => [
      slide.id,
      slide,
    ]),
  );
  const inTask = new Set(input.task?.slideIds ?? []);
  const row = (id: string, name: string, loose: boolean): LivePopoverRow => {
    const known = byId.get(id);
    const current = id === input.slideId;
    const building = !current && buildingStates.has(known?.status ?? "");
    const names =
      current && input.currentSetNames !== undefined
        ? input.currentSetNames
        : (known?.result_sets ?? []).map((set) => set.name);
    const mine = known?.reviews?.find((review) => review.task_id === input.task?.id)?.state;
    const status: LivePopoverRow["status"] = current
      ? { label: input.task ? "In review" : "Open", tone: "accent" }
      : building
        ? { label: "Processing", tone: "neutral" }
        : mine !== undefined && submittedStates.has(mine)
          ? { label: "Submitted", tone: "ok" }
          : input.task === undefined
            ? { label: sentence(known?.status ?? ""), tone: "neutral" }
            : inTask.has(id)
              ? { label: "To review", tone: "neutral" }
              : { label: "Not in task", tone: "neutral" };
    const listed = names.join(" · ");
    const sub = loose ? (listed ? `${listed}, no case attached` : "No case attached") : listed;
    return {
      id,
      name,
      ...(sub ? { sub } : {}),
      resultSets: names.length,
      current,
      building,
      status,
    };
  };
  if (input.caseSlides === undefined || input.caseSlides.length === 0) {
    return {
      caseRows: input.list.slides.map((slide) => row(slide.id, slide.label, false)),
      looseRows: [],
    };
  }
  const inCase = new Set(input.caseSlides.map((slide) => slide.id));
  return {
    caseRows: input.caseSlides.map((slide) =>
      row(slide.id, slide.stain ? `${slide.label} · ${slide.stain}` : slide.label, false),
    ),
    looseRows: [...inTask]
      .filter((id) => !inCase.has(id) && (byId.get(id)?.case_id ?? null) === null)
      .map((id) => row(id, byId.get(id)?.label ?? "Slide", true)),
  };
}
