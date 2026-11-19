import { HttpHandler, matchRequestUrl, type RequestHandler } from "msw";

type Parse = HttpHandler["parse"];

const unmatched: Awaited<ReturnType<Parse>> = {
  match: { matches: false, params: {} },
  cookies: {},
};

function skipping(handler: HttpHandler): Parse {
  const { method, path } = handler.info;
  const parseFully: Parse = handler.parse.bind(handler);
  if (typeof path === "function") return parseFully;
  return async (args) => {
    const asked = args.request.method;
    const sameMethod =
      method instanceof RegExp ? method.test(asked) : method.toLowerCase() === asked.toLowerCase();
    if (!sameMethod) return unmatched;
    const url = new URL(args.request.url);
    if (!matchRequestUrl(url, path, args.resolutionContext?.baseUrl).matches) return unmatched;
    return parseFully(args);
  };
}

export function skipUnmatched<Handler extends RequestHandler>(handlers: Handler[]): Handler[] {
  for (const handler of handlers) {
    if (handler instanceof HttpHandler) handler.parse = skipping(handler);
  }
  return handlers;
}
