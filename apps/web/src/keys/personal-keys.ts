import { createContext, useContext, useMemo } from "react";
import type { Resolve, Scope } from "./actions.ts";
import { keyRegistry } from "./catalogue.ts";
import type { Binding } from "./registry.ts";

export const PersonalKeys = createContext<Resolve>({});

export const usePersonalKeys = () => useContext(PersonalKeys);

export function personalBindings(
  resolve: Resolve,
  scopes: readonly Scope[],
  only: readonly string[],
): Binding[] {
  if (only.length === 0) return [];
  return keyRegistry.bindings({
    ...(resolve.preset === undefined ? {} : { preset: resolve.preset }),
    ...(resolve.personal === undefined ? {} : { personal: resolve.personal }),
    scopes,
    only,
  });
}

const words = (text: string) => (text === "" ? [] : text.split(" "));

export function useBindings(
  scopes: readonly Scope[],
  only: readonly string[],
  enabled = true,
): Binding[] {
  const resolve = usePersonalKeys();
  const scopeKey = scopes.join(" ");
  const onlyKey = only.join(" ");
  return useMemo(
    () => (enabled ? personalBindings(resolve, words(scopeKey) as Scope[], words(onlyKey)) : []),
    [resolve, scopeKey, onlyKey, enabled],
  );
}
