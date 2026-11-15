import { createContext, useContext } from "react";
import type { SmartServicesLoader } from "./smart-services.ts";

export const SharedSmartServicesContext = createContext<SmartServicesLoader | null>(null);

export function useSharedSmartServices(): SmartServicesLoader | null {
  return useContext(SharedSmartServicesContext);
}
