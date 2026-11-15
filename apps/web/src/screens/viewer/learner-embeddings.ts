import { createContext, useContext } from "react";
import type { PooledFeaturesOf } from "./slide-learner.ts";

export const LearnerEmbeddingsContext = createContext<PooledFeaturesOf | null>(null);

export const useLearnerEmbeddings = () => useContext(LearnerEmbeddingsContext);
