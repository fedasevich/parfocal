# Result: the enforced CSP and isolation headers keep module workers and WASM threads working, checked locally

- Date: 2026-11-02
- Backlog: SEC-011 (security headers and CSP)
- Kind: check
- Commit: the SEC-011 commit, measured from the working tree on top of dafcf80
- Environment: MacBook, Node 26, Playwright Chromium headless, `http://localhost`. No cloud resource was used, cost $0
- Data: the production build of `apps/web` with `PARFOCAL_PUBLIC_APP_ENV=preview`, no slides

## Question

Does the policy built by `apps/edge/src/security-headers.ts` (strict CSP with a per-request nonce, COOP `same-origin`, COEP `credentialless`, CORP `same-origin`) still let the app boot, start module workers and run threaded WASM, as ADR 0015 (Vite build tool, cross-origin isolation for workers and WASM) and ADR 0148 (browser ML runtime, onnxruntime-web) need?

## Method

1. `vite build` with `html.cspNonce` set to the placeholder `PARFOCAL_CSP_NONCE`. The built `index.html` carried the placeholder on the entry script, every `modulepreload` link and the `csp-nonce` meta tag, had no inline script without a nonce, and no built chunk contained `eval` or `new Function(`.
2. A throwaway Node server served the build through `withSecurityHeaders`, so every response got the same headers the Worker sends, with an enforced (not report-only) CSP and an upload origin of `https://acc.r2.cloudflarestorage.com`.
3. Playwright loaded `/`, collected console messages and page errors, and from the page started the built `decode.worker` chunk and a probe module worker that compiled a WASM module, created a shared `WebAssembly.Memory` and imported the decode worker chunk.

## Results

| Check | Outcome |
|---|---|
| App boots under the enforced CSP | Yes, the root rendered 2 children |
| CSP violations or page errors in the console | 0 |
| `crossOriginIsolated` in the page | true |
| WASM compile in the page (`'wasm-unsafe-eval'`) | Yes |
| Built `decode.worker` starts as a module worker | Yes, no error event within 1.5 s |
| Probe worker `crossOriginIsolated`, `SharedArrayBuffer` | true, available |
| Shared WASM memory in the worker (WASM threads) | Yes |
| Dynamic module import inside the worker | Yes |

## Limits

onnxruntime-web is not yet a dependency of any package, so its own `.mjs` and `.wasm` files were not loaded. The probe covers the browser features it relies on (module workers, `SharedArrayBuffer`, shared WASM memory and WASM compilation) under the same headers. WebGPU needs no CSP keyword. The header test against staging (`PARFOCAL_HEADERS_URL=<staging url> node --test apps/edge/test/deployed-headers.test.ts`) has not run, because nothing was deployed. Only Chromium was checked.
