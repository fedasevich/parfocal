# Result: monorepo, CI and Python tooling re-check

- Date: 2026-11-03
- Backlog: FOUND-000 (research check for monorepo, CI and developer experience). Repeats part of [the 2026-10-06 tooling spike](2026-10-06-tooling-spike.md)
- Kind: check
- Commit: 5c6be93
- Environment: Linux x86_64 cloud container, uv 0.11.32. Wheel resolution targeted Linux `manylinux_2_28` on x86_64 and aarch64
- Data: none

## Question

Do [ADR 0006](../adr/0006-monorepo-tooling.md) (monorepo tooling), [ADR 0007](../adr/0007-python-tooling.md) (Python tooling) and [ADR 0011](../adr/0011-hosted-ci-only.md) (hosted CI only) still hold against the releases current on 2026-11-03, and is any upgrade due?

## Method

1. Latest versions from the npm registry (`registry.npmjs.org/<name>/latest`) and the PyPI JSON API, on 2026-11-03.
2. Latest GitHub Action tags with `git ls-remote --tags` on each action's repository.
3. Node release lines from `nodejs.org/dist/index.json`. Python 3.15 releases from the tags of the official `python` image on Docker Hub.
4. The same requirement list as the 2026-10-06 spike, resolved with `uv pip compile req.in --python-version {3.14,3.15} --python-platform {x86_64,aarch64}-manylinux_2_28 --only-binary :all:`, then single packages on 3.15 to find the blockers.
5. One web search on GitHub hosted runner changes. The GitHub changelog page itself was not reachable from the container, so the Ubuntu 26.04 row below rests on the search result's summary of it.

## Results

JavaScript tooling:

| Tool | Pinned in the repository | Latest | Within the pin |
|---|---|---|---|
| pnpm | 12.9.1 | 12.16.1 | no, exact pin |
| Turborepo | 2.11.7 | 2.11.10 | no, exact pin |
| TypeScript | 7.0.2 | 7.0.2 | yes |
| Biome | 2.5.15 | 2.6.4 | no, exact pin |
| Oxlint | 1.87.0 | 1.90.0 | no, exact pin |
| oxlint-tsgolint | 7.0.2003 | 7.0.2005 | no, exact pin |
| Lefthook | 2.1.17 | 2.2.2 | no, exact pin |
| commitlint | 21.2.3 | 21.2.4 | no, exact pin |
| git-cliff | 2.14.2 | 2.14.2 | yes |
| Playwright | 1.64.0 | 1.64.1 | no, exact pin |
| typescript-eslint | not used | 8.72.1, peer `typescript >=4.8.4 <6.1.0` | not applicable |
| Node | `.node-version` 26 | 26.13.0, LTS "Lithium" since 2026-10-28 | yes |

Python tooling:

| Tool | Pinned in the repository | Latest | Within the pin |
|---|---|---|---|
| Ruff | `>=0.16,<0.17`, locked 0.16.10 | 0.17.3 | no |
| uv and `uv_build` | `uv_build>=0.12,<0.13` | 0.13.7 | no |
| basedpyright | `>=1.40,<2`, locked 1.40.2 | 1.40.2 | yes |
| pytest | `>=9.1,<10`, locked 9.1.1 | 9.2.0 | yes |
| pytest-asyncio | `>=1.4,<2`, locked 1.4.0 | 1.4.1.post1 | yes |
| ty | not used | 0.0.96, classifier "Development Status :: 4 - Beta" | not applicable |

GitHub Actions:

| Action | Used | Latest tag |
|---|---|---|
| actions/checkout | v7 | v7.0.1 |
| actions/setup-node | v7 | v7.1.0 |
| actions/setup-python | v7 | v7.1.0 |
| actions/cache | v6 | v6.1.0 |
| pnpm/action-setup | v6 | v6.1.0 |
| astral-sh/setup-uv | v10.2.0 | v10.3.3 |

Python 3.15: Docker Hub's official image has tags 3.15.0, 3.15.1 and 3.15.2. Wheel resolution, packages resolved per target:

| Python | x86_64 | aarch64 |
|---|---|---|
| 3.14 | 237, resolves | 237, resolves |
| 3.15 | fails | fails |

On 3.15 these have no `cp315` wheels: onnxruntime 1.31.1 (wheels up to `cp314t`), scikit-image (only 0.27.0rc1 has them) and numcodecs, which zarr needs. torch 2.15.0, numpy 2.5.4, imagecodecs, tiatoolbox, monai, timm, torchvision, cellpose, stardist, opencv-python-headless, scipy, shapely, asyncpg and pydantic-core resolve on 3.15 alone.

Hosted runners: the search result reports a GitHub changelog entry of 2026-09-17 that moves `ubuntu-latest` from Ubuntu 24.04 to Ubuntu 26.04, rolled out between 2026-10-19 and 2026-11-19. Every job in `.github/workflows/` uses `ubuntu-latest`.

## Interpretation

- ADR 0006 holds. TypeScript 7 is still current and typescript-eslint still stops below TypeScript 6.1, so type-aware Oxlint remains the only option for type-aware rules.
- ADR 0007 holds. Python 3.14 is still the newest version the planned stack installs on from wheels. 3.15 is out but onnxruntime, scikit-image and numcodecs block it. ty is still Beta.
- ADR 0011 holds. Nothing found changes the hosted-only decision, and every action is on its latest major.
- Two upgrades are due. Ruff 0.17 and uv 0.13 sit outside the version ranges in `pyproject.toml`, and the exact JavaScript pins trail by minor or patch releases. The move of `ubuntu-latest` to 26.04 can change system libraries under the SwiftShader golden-image suite, which is the one suite sensitive to them (assumption, not measured).

## Follow-ups

- Existing ADRs confirmed, no new ADR.
- FOUND-027 added: refresh the tooling pins.
- FOUND-028 added: pin or verify the CI runner image for Ubuntu 26.04.
- TODO: re-check Python 3.15 when onnxruntime, scikit-image and numcodecs publish `cp315` wheels.
