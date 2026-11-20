import { useGetMe } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { canUseDeveloperMode } from "./developer-access.ts";

export function useDeveloperAllowed(): boolean {
  const signedIn = useSignedInArea();
  return canUseDeveloperMode(okData(useGetMe({ query: { enabled: signedIn } }).data));
}
