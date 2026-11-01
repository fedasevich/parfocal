import { createRouter } from "@tanstack/react-router";
import { PrototypeFrame } from "./flow-map/prototype-bar.tsx";
import { routeTree } from "./routeTree.gen.ts";

export function createAppRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    ...(import.meta.env.DEV ? { InnerWrap: PrototypeFrame } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
