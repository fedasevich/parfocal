import { createContext, useContext } from "react";

export type StageOpenState = {
  readonly rail: boolean;
  readonly onFailed: (failed: boolean) => void;
};

const ignore = () => {};

const StageOpenContext = createContext<StageOpenState>({ rail: true, onFailed: ignore });

export const StageOpenStateProvider = StageOpenContext.Provider;

export function useStageOpenState(): StageOpenState {
  return useContext(StageOpenContext);
}
