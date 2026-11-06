import { createInferenceEngine } from "../sam/inference-engine.ts";
import { createModelCache, type ModelStorageManager } from "../sam/model-cache.ts";
import { createOrtRuntime } from "../sam/ort-runtime.ts";
import { startSamWorker } from "../sam/worker-runtime.ts";

interface GpuNavigator {
  readonly gpu?: { requestAdapter(): Promise<unknown> };
  readonly storage: { persist?: () => Promise<boolean> };
}

function persistentStorage(navigator: GpuNavigator): ModelStorageManager | null {
  const persist = navigator.storage.persist;
  return persist === undefined ? null : { persist: () => persist.call(navigator.storage) };
}

startSamWorker(self, {
  createEngine(modelsUrl, onStage) {
    const cache = createModelCache({
      caches: self.caches,
      fetch: (url, init) => self.fetch(url, init),
      storage: persistentStorage(self.navigator as GpuNavigator),
    });
    return createInferenceEngine({
      runtime: createOrtRuntime(self.navigator.hardwareConcurrency),
      cache,
      modelsUrl,
      onStage,
      hasGpuAdapter: async () => {
        const gpu = (self.navigator as GpuNavigator).gpu;
        return gpu === undefined ? false : (await gpu.requestAdapter()) !== null;
      },
    });
  },
});
