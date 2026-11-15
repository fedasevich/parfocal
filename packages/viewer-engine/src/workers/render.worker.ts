import type { RenderRequest } from "../custom-webgpu/protocol.ts";
import { createRenderHost } from "../custom-webgpu/render-host.ts";

const host = createRenderHost({
  post: (response) => self.postMessage(response),
  requestFrame: (callback) => {
    self.requestAnimationFrame(callback);
  },
  gpu: self.navigator.gpu,
});

self.addEventListener("message", (event: MessageEvent<RenderRequest>) => {
  host.handle(event.data);
});
