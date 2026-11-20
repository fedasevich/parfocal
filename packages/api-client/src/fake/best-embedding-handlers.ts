import { delay, HttpResponse, http, type RequestHandler } from "msw";

const scenes = ["answers", "slow", "refuse", "offline"] as const;

export type FakeBestScene = (typeof scenes)[number];

let scene: FakeBestScene = "answers";

const isScene = (value: unknown): value is FakeBestScene =>
  typeof value === "string" && scenes.some((each) => each === value);

export function setFakeBestScene(next: unknown): void {
  scene = isScene(next) ? next : "answers";
}

export const fakeBestEncoder = "pathosam-vit-l-histopathology-fp32";
export const fakeBestEmbeddingBytes = 256 * 64 * 64 * 2;
export const fakeBestHoldMs = 1500;
export const fakeBestAnswerMs = 2500;

const answered = () =>
  new HttpResponse(new ArrayBuffer(fakeBestEmbeddingBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Parfocal-Encoder": fakeBestEncoder,
      "Cache-Control": "no-store",
    },
  });

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: `https://parfocal.eu/problems/${code}`, title, status, code },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );

export const bestEmbeddingHandlers = (): RequestHandler[] => [
  http.post("*/api/slides/:slideId/embeddings/view", async ({ request }) => {
    const call = new URL(request.url).searchParams.get("call");
    if (scene === "refuse") return problem(404, "view-outside", "This view reaches past the slide");
    if (scene === "offline") {
      return problem(
        503,
        "encoder-offline",
        "No encoder worker is answering. Try again in a moment",
      );
    }
    if (scene === "answers") return answered();
    if (call === null) {
      await delay(fakeBestHoldMs);
      return HttpResponse.json(
        { state: "waiting", call: "fake-best-call", waited_seconds: 46, hold_seconds: 45 },
        { status: 202, headers: { "Cache-Control": "no-store", "Retry-After": "0" } },
      );
    }
    await delay(fakeBestAnswerMs);
    return answered();
  }),
  http.delete("*/api/gpu-calls/:call", () => new HttpResponse(null, { status: 204 })),
];
