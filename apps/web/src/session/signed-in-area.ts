import { useLocation } from "@tanstack/react-router";
import { locksAt } from "./lock-rules.ts";

export function useSignedInArea(): boolean {
  return useLocation({ select: (location) => locksAt(location.pathname) });
}
