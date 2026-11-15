import type { SmartOpenRequest, SmartServicesLoader } from "../../aiseg/smart-services.ts";
import type { LoadedEmbeddingServices } from "./lazy-embedding-features.ts";

const unknownSlideSize = { width: 10_000_000, height: 10_000_000 } as const;

export async function loadLearnerServices(
  loader: SmartServicesLoader,
  open: () => Promise<SmartOpenRequest>,
): Promise<LoadedEmbeddingServices> {
  const services = await loader({ slide: unknownSlideSize, open });
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
}
