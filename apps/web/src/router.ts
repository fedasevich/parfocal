import { createRouter } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { routeTree } from "./routeTree.gen.ts";

type Frame = (props: { children: ReactNode }) => ReactElement;

export function createAppRouter(frame?: Frame) {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    ...(frame ? { InnerWrap: frame } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
