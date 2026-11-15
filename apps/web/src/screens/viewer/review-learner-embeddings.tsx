import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SharedSmartServicesContext } from "../../aiseg/shared-smart-services.ts";
import {
  loadSmartServices,
  type SmartServicesLoader,
  shareServices,
} from "../../aiseg/smart-services.ts";
import { loadViewerEngine } from "../../viewer/load-engine.ts";
import { grantFor } from "../../viewer/tile-grant.ts";
import { ringOfShape } from "../review/cell-ring.ts";
import { cellShapes } from "../review/slide-geometry.ts";
import {
  createLazyEmbeddingFeatures,
  type LazyEmbeddingFeatures,
} from "./lazy-embedding-features.ts";
import { LearnerEmbeddingsContext } from "./learner-embeddings.ts";
import { loadLearnerServices } from "./load-learner-services.ts";

async function openRequestFor(slideId: string) {
  const engine = await loadViewerEngine();
  const access = engine.createSlideAccess((previous) => grantFor(slideId, previous));
  const grant = await access.grant();
  return engine.signedOpenRequest({
    access: access.access,
    basePath: grant.basePath,
    original: grant.original,
    identifiedFormat: grant.format ?? null,
  });
}

export function ReviewLearnerEmbeddings({
  slideId,
  loader = loadSmartServices,
  children,
}: {
  slideId: string;
  loader?: SmartServicesLoader;
  children: ReactNode;
}) {
  const [lazy, setLazy] = useState<LazyEmbeddingFeatures | null>(null);
  const shared = useMemo(() => shareServices(loader), [loader]);
  useEffect(() => {
    const made = createLazyEmbeddingFeatures({
      slideKey: slideId,
      preset: "nuclei",
      ringOf: (object) => ringOfShape(cellShapes[object]),
      load: () => loadLearnerServices(shared, () => openRequestFor(slideId)),
    });
    setLazy(made);
    return () => {
      made.close();
      setLazy(null);
    };
  }, [slideId, shared]);
  return (
    <SharedSmartServicesContext.Provider value={shared}>
      <LearnerEmbeddingsContext.Provider value={lazy?.features ?? null}>
        {children}
      </LearnerEmbeddingsContext.Provider>
    </SharedSmartServicesContext.Provider>
  );
}
