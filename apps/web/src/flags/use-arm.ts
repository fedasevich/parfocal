import { useGetMe } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import { appEventSink } from "../telemetry/app-events.ts";
import { defaultArm, experimentCache, experimentsLive, flagContextFor } from "./app-experiments.ts";
import type { ArmOf, FlagKey } from "./catalogue.ts";
import { localFlagService } from "./flags.ts";

const live = experimentsLive({
  appEnv: import.meta.env.PARFOCAL_PUBLIC_APP_ENV,
  fakeApi: import.meta.env.PARFOCAL_PUBLIC_FAKE_API || "off",
});

const appExperiments = experimentCache(localFlagService(), appEventSink);

export function useArm<Key extends FlagKey>(flagKey: Key, applies = true): ArmOf<Key> {
  const me = okData(useGetMe({ query: { enabled: live } }).data);
  const context = live && applies && me !== undefined ? flagContextFor(me) : undefined;
  return context === undefined ? defaultArm(flagKey) : appExperiments.for(context).arm(flagKey);
}
