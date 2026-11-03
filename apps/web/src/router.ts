import { createRouter } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { routeTree } from "./routeTree.gen.ts";
import { routeTransition, viewTransitions } from "./shell/view-transitions.ts";

type Frame = (props: { children: ReactNode }) => ReactElement;

export function createAppRouter(frame?: Frame) {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    ...(frame ? { InnerWrap: frame } : {}),
  });
  router.startViewTransition = (update: () => Promise<void>) =>
    viewTransitions.run(
      update,
      routeTransition(router.state.resolvedLocation?.pathname, router.latestLocation.pathname),
    );
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
