# Result: monorepo tooling and Python wheel check

- Date: 2026-10-06
- Backlog: STACK-013, STACK-018
- Kind: spike
- Commit: c8e20eb (no application code yet. The spike ran in a throwaway folder outside the repository)
- Environment: MacBook, macOS 15.8.1, arm64, Node 26.9.0, pnpm 12.9.1, uv 0.12.18. Wheel resolution targeted Linux `manylinux_2_28` on x86_64 and aarch64
- Data: none

## Question

1. Does the full planned Python stack install from wheels alone on Python 3.13 and 3.14, on Linux x86_64 and aarch64? The backlog default was 3.13 because the POC found no 3.14 wheels for MONAI Label (doc 12).
2. Which Python versions do Modal images support?
3. Does type-aware linting work with TypeScript 7, now that typescript-eslint supports only TypeScript below 6.1?
4. Can Turborepo run and cache Python tasks in the same task graph as TypeScript tasks?

## Method

1. Versions were read from the PyPI JSON API and the npm registry on 2026-10-06.
2. For each Python version and platform: `uv pip compile req.in --python-version {3.13,3.14} --python-platform {x86_64,aarch64}-manylinux_2_28 --only-binary :all:`. `req.in` held torch, openslide-python, openslide-bin, tifffile, zarr, imagecodecs, numpy, tiffslide, tiatoolbox, onnxruntime, scikit-image, fastapi, uvicorn[standard], sqlalchemy[asyncio], asyncpg, alembic, pydantic, pydantic-settings, geoalchemy2, modal, boto3 and fhir.resources. The same command ran for monai, timm, huggingface_hub, torchvision, opencv-python-headless, scipy, shapely, cellpose and stardist one at a time.
3. The Python versions accepted by Modal image builder versions were read from `modal/image.py` in the Modal client installed by `uvx modal setup`.
4. A throwaway pnpm workspace held one TypeScript package and one Python package (uv workspace member, with a `package.json` whose `test` script is `uv run --package py-api pytest -q`). The TypeScript file contained an unawaited promise. Commands: `tsc --noEmit` (TypeScript 7.0.2), `oxlint --type-aware -A all -D typescript/no-floating-promises`, `biome check`, then `turbo run test typecheck` three times, editing the Python source before the third run.

## Results

Tool versions on 2026-10-06:

| Tool | Version | Tool | Version |
|---|---|---|---|
| uv | 0.12.23 | pnpm | 12.9.1 |
| ruff | 0.16.10 | turbo | 2.11.7 |
| basedpyright | 1.40.2 | @biomejs/biome | 2.5.15 |
| pyright | 1.1.414 | oxlint | 1.87.0 |
| ty | 0.0.84 (Beta) | oxlint-tsgolint | 7.0.2003 |
| pytest | 9.1.1 | typescript | 7.0.2 (latest), 6.0.3 (last 6.x) |
| pytest-asyncio | 1.4.0 | typescript-eslint | 8.71.1, peer `typescript >=4.8.4 <6.1.0` |

Wheel-only resolution of the full stack:

| Python | x86_64 | aarch64 |
|---|---|---|
| 3.13 | resolved, 236 packages | resolved, 236 packages |
| 3.14 | resolved, 236 packages | resolved, 236 packages |

ML libraries resolved wheel-only on 3.13 and 3.14, both architectures: monai, timm, huggingface_hub, torchvision, opencv-python-headless, scipy, shapely, cellpose, stardist. None failed.

Modal image builder `2025.06` and `PREVIEW` accept Python 3.10 to 3.14 and 3.14t. Builder `2024.10` stops at 3.13.

Lint and typecheck spike:

| Check | Outcome |
|---|---|
| `tsc --noEmit` on TypeScript 7.0.2 | passed |
| `oxlint --type-aware` with `no-floating-promises` | reported the unawaited promise at `index.ts:3:3` |
| `biome check` | ran and reported formatting errors on the spike file |

Turborepo caching:

| Run | Cached |
|---|---|
| Without a `.gitignore` | 0 of 2 on the second run |
| With `node_modules/`, `.turbo/`, `__pycache__/`, `.pytest_cache/` and `.venv/` ignored, second and third run | 2 of 2, "FULL TURBO" |
| After editing the Python source | 1 of 2 (only the Python test reran) |

## Interpretation

- The condition behind the 3.13 default no longer holds. Every planned package, including MONAI, has Linux wheels for 3.14 on both architectures, and Modal images support 3.14.
- typescript-eslint cannot run on TypeScript 7. Oxlint's type-aware mode runs on TypeScript 7 and covers the rule the backlog needed it for.
- Python tasks join the Turborepo graph through a `package.json` per Python package. Turborepo hashes files that git does not ignore, so Python and turbo caches must stay git-ignored or every run misses the cache.

## Follow-ups

- [ADR 0006](../adr/0006-monorepo-tooling.md) and [ADR 0007](../adr/0007-python-tooling.md) rely on this result.
- TODO: Tools that call the TypeScript compiler API (OpenAPI client generators, Storybook docgen) may need their own TypeScript 6 dependency. Check in STACK-008 and STACK-012.
