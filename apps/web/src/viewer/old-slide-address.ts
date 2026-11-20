import { redirect } from "@tanstack/react-router";
import type { SlideSearch } from "../search/route-searches.ts";
import { slidePath } from "../shell/slide-link.ts";

export function slideRedirect(
  params: { projectId: string; slideId: string },
  given: Record<string, unknown>,
  change: Record<string, unknown>,
) {
  const merged: Record<string, unknown> = { ...given, ...change };
  const kept = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as SlideSearch;
  return redirect({ to: slidePath, params, search: kept, replace: true });
}
