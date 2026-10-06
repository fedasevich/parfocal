# 0007. Python 3.14 with uv, Ruff, basedpyright and pytest

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-018. Touches FOUND-001, FOUND-005, FOUND-015 and every Modal image.

## Context

STACK-018 picks the Python version and tooling for `apps/api` and `workers/*`. The backlog default was Python 3.13, because the POC found no 3.14 wheels for MONAI Label (doc 12), with uv, Ruff, basedpyright and pytest. The task is done when the scientific stack is confirmed to have wheels for the chosen version on Linux x86_64 and aarch64.

The check on 2026-10-06 ([result](../results/2026-10-06-tooling-spike.md)) resolved the full planned stack (236 packages, including torch, openslide, tifffile, zarr, imagecodecs, tiatoolbox and onnxruntime) from wheels alone on both 3.13 and 3.14, on both architectures. MONAI, timm, torchvision, cellpose and stardist also resolved on 3.14. Modal image builder `2025.06` supports 3.14.

## Options considered

1. Python 3.13. The safe choice in 2025, supported until October 2029. It gives nothing over 3.14 now that wheels exist.
2. Python 3.14. Supported until October 2030, with every planned package available as wheels and Modal support. A future pathology model package without 3.14 wheels could force a pin.
3. Type checker: basedpyright (production status, strict mode), pyright, or ty (Astral, still Beta at 0.0.84). basedpyright adds stricter defaults and better editor support over pyright. ty is not stable yet.

## Decision

| Concern | Choice |
|---|---|
| Python | 3.14, `requires-python = ">=3.14,<3.15"` |
| Environments, lockfile, workspace | uv, with one root `pyproject.toml` defining a uv workspace and one `uv.lock` |
| Build backend | `uv_build` |
| Lint and format | Ruff |
| Types | basedpyright, strict for `apps/api` and shared packages, standard for ML code in `workers/*` |
| Tests | pytest 9 with pytest-asyncio |
| Modal images | image builder version `2025.06` or later, Python 3.14 |

Python 3.14 wins because the reason for the 3.13 default is gone and 3.14 adds a year of support.

## Consequences

- If a model package needed by an AI epic has no 3.14 wheels, that ML worker may pin 3.13 in its own Modal image. The API and shared packages stay on 3.14. Record such a pin in the AI research check that finds it.
- ty is reconsidered when it leaves Beta.
- FOUND-001 creates the uv workspace. FOUND-005 sets up Ruff, basedpyright and pytest. FOUND-015 builds Modal images on Python 3.14.
