# 0098. Viv 0.23 on deck.gl 9.4 and luma.gl 9.4.2 over WebGL2, with deck.gl's WebGPU backend as the alternate route and a dispose wrapper for the canvas leak

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-015. Touches VIEW-000, VIEW-002, VIEW-030, VIEW-031, VIEW-036, VIEW-037 and STACK-016

## Context

Viv is the primary renderer and must work perfectly. Its layers are GLSL ES 3.0 shaders, so Viv runs on WebGL2. The POC ran Viv 0.22.1, which peers on deck.gl `~9.3`, and installed deck.gl 9.4 a second time in a nested folder for its WebGPU route, with Vite pre-bundling exclusions to keep the two copies apart (POC doc 23). POC doc 24 found two luma.gl problems: `Deck.finalize()` never destroys the device's canvas context, so a media query listener keeps every old deck with its layers and textures alive, and luma.gl built a debug string with `getGLKeys` for every tile sampler even though the string was never printed. The POC fixed both in its own code (`releaseCanvas` and `skipGLKeyLogging`).

Versions were checked on npm on 2026-10-23. Viv 0.23.0 (2026-09-23) now peers on deck.gl `~9.4.0` and luma.gl `~9.4.0`. deck.gl's latest is 9.4.0 and luma.gl's is 9.4.2. luma.gl 10 is in alpha. The [spike](../results/2026-10-23-viv-version-spike.md) opened CMU-1.svs in Viv on these versions and ran the 20-slide-switch memory test in headless Chrome 155.

## Options considered

Versions:

1. Keep the POC's Viv 0.22.1 on deck.gl 9.3. Known to work in the POC, but a deck.gl 9.4 WebGPU route needs a second deck.gl copy again, and luma.gl 9.3 still builds the debug string.
2. Viv 0.23.0 on deck.gl 9.4.0 and luma.gl 9.4.2. One copy of deck.gl and luma.gl, and luma.gl 9.4.2 guards the debug string with `if (log.level >= 2)`. Viv 0.23 is a month old and the POC never ran it, but the spike drew CMU-1.svs correctly and passed the memory test on it.
3. luma.gl 10 alpha. Viv's peers do not allow it, and an alpha has no place under the primary renderer.

The WebGPU route:

1. deck.gl 9.4 on its WebGPU backend as the alternate route behind the renderer interface, in the developer drawer only, as the decisions baseline in the backlog already says. With option 2 it shares Viv's deck.gl install.
2. Drop the deck.gl WebGPU route and keep only Viv and the custom WebGPU engine. Less to maintain, but it loses the comparison doc 23 used to separate what WebGPU is worth from what the layer stack is worth.
3. Make deck.gl WebGPU the default for RGB slides. deck.gl labels it experimental, doc 23 found two defaults that fail silently (`minZoom` and buffer limits) and a 632 ms main-thread cost to replace a million polygons against 367 ms on WebGL2, and it would contradict the rule that Viv is primary.

The luma.gl fixes:

1. `pnpm patch` (patch-package) on the published files. The fix then applies wherever deck.gl is used, but each package ships ESM, CommonJS and a dev bundle that would all need the same patch, and every version bump breaks it.
2. An upstream pull request. Right in the long run, but nothing ships until deck.gl or luma.gl releases it, and the viewer cannot wait.
3. A wrapper in our own code. Small, independent of the version, and covered by the memory test, but it has to be used everywhere a deck is torn down.

## Decision

Versions option 2, pinned exactly: `@hms-dbmi/viv` 0.23.0, `@deck.gl/core`, `@deck.gl/layers` and `@deck.gl/geo-layers` 9.4.0, and `@luma.gl/core`, `@luma.gl/webgl`, `@luma.gl/engine`, `@luma.gl/constants` and `@luma.gl/shadertools` 9.4.2, with `@luma.gl/webgpu` 9.4.2 only for the alternate route. luma.gl 9.4.2 is the floor, because 9.4.0 and 9.4.1 still build the debug string. deck.gl and luma.gl move only together with a Viv release whose peers allow the new version, and every bump reruns the memory test.

WebGPU option 1. deck.gl 9.4 on WebGPU stays the alternate route for 8-bit RGB slides, built in VIEW-037 (deck.gl 9.4 WebGPU route) on the same install, with `@luma.gl/webgpu` loaded only when the route is chosen. Viv itself stays on WebGL2, since its shaders are GLSL only.

For the fixes, a mix of options 3 and 2:

- The canvas leak gets a wrapper. The engine's dispose calls `deck.finalize()`, then `deck.device.canvasContext.destroy()`, then `WEBGL_lose_context.loseContext()`, sets the canvas to zero size and removes it. `device.destroy()` is not enough, because deck.gl creates its device with `_reuseDevices: true`, which makes `destroy()` do nothing. The leak should also be reported upstream (TODO: owner to decide whether to file it), and the wrapper stays until a release passes the memory test without it.
- The debug string needs nothing, because it is fixed upstream from luma.gl 9.4.2. The POC's `skipGLKeyLogging` is not carried over.

The spike's numbers: with the wrapper exactly one `Deck` was alive after each of 20 switches and none after closing, and the heap at the last CMU-1.svs visit was 3.7% to 4.4% above the first. Without `canvasContext.destroy()` all 21 decks stayed alive and the heap grew by 691% to 696%. On luma.gl 9.4.1 the same run built the debug string 2,132 times for 993 ms, and on 9.4.2 never ([result](../results/2026-10-23-viv-version-spike.md)).

## Consequences

- VIEW-002 (Viv route for RGB brightfield) and VIEW-030 (memory and teardown correctness) use these versions. The wrapper belongs in the viewer engine's dispose, and VIEW-030's memory test should count live `Deck` objects with `Runtime.queryObjects` as the spike did, and keep a run without the wrapper as the canary that shows whether upstream fixed the leak.
- VIEW-031 (luma.gl debug-string cost patch) no longer needs a patch. Its perf test stays as a regression check on the luma.gl floor. TODO: edit VIEW-031's text to say so.
- VIEW-037 (deck.gl 9.4 WebGPU route) builds on the same deck.gl install, without the POC's nested copy. TODO: confirm in VIEW-037 that Vite needs no `optimizeDeps` exclusions with one copy.
- Viv 0.23 draws interleaved RGB through its `BitmapLayer`, not `XRLayer`, so doc 24's `r8unorm` texture patch for `XRLayer` matters only for multichannel slides.
- Viv's loaders depend on geotiff 2 while STACK-016 (TIFF and Zarr readers in the browser) is expected to choose geotiff 3. TODO: check in VIEW-002 (Viv route for RGB brightfield) whether the bundle carries both.
- VIEW-000 (research check for the viewer stack) can record these versions as the ones in use once this record is accepted.
- The spike ran on a real GPU through ANGLE Metal. TODO: VIEW-030 (memory and teardown correctness) repeats it on hosted Linux with SwiftShader ([ADR 0011](0011-hosted-ci-only.md)).
