export const pageHas = (request: Request, part: string) =>
  [request.referrer, request.headers.get("referer") ?? ""].some((url) => url.includes(part));

export const drawnPage = (request: Request) => pageHas(request, "source=drawn");
