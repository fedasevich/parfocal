import { type ReactNode, useEffect, useState } from "react";
import { loadSmartServices, type SmartServicesLoader } from "../../aiseg/smart-services.ts";
import { loadViewerEngine } from "../../viewer/load-engine.ts";
import { grantFor } from "../../viewer/tile-grant.ts";
import { ringOfShape } from "../review/cell-ring.ts";
import { cellShapes } from "../review/slide-geometry.ts";
import {
  createLazyEmbeddingFeatures,
  type LazyEmbeddingFeatures,
} from "./lazy-embedding-features.ts";
import { LearnerEmbeddingsContext } from "./learner-embeddings.ts";

const unknownSlideSize = { width: 10_000_000, height: 10_000_000 } as const;

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
  useEffect(() => {
    const made = createLazyEmbeddingFeatures({
      slideKey: slideId,
      preset: "nuclei",
      ringOf: (object) => ringOfShape(cellShapes[object]),
      load: async () => {
        const services = await loader({
          slide: unknownSlideSize,
          open: () => openRequestFor(slideId),
        });
        const { sam } = services;
        if (sam.pool === undefined) {
          services.close();
          throw new Error("The SAM service cannot pool cell features");
        }
        const pool = sam.pool.bind(sam);
        return {
          services: {
            reader: services.reader,
            sam: { encode: (...args) => sam.encode(...args), pool, drop: (id) => sam.drop(id) },
          },
          close: services.close,
        };
      },
    });
    setLazy(made);
    return () => {
      made.close();
      setLazy(null);
    };
  }, [slideId, loader]);
  return (
    <LearnerEmbeddingsContext.Provider value={lazy?.features ?? null}>
      {children}
    </LearnerEmbeddingsContext.Provider>
  );
}
