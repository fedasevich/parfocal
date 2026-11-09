# 0278. Load tests run on Locust from the uv workspace and refuse any target that is not local or staging

- Date: 2026-11-09
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: TEST-010 (load test tooling), used later by OPS-012 (load and soak testing)

## Context

TEST-010 asks for k6 or Locust scenarios for the API, tiles and realtime, run on demand. [ADR 0273](0273-test-pyramid-and-ownership.md) (the test pyramid) places load tests outside the pull request path, against staging and never production, and [ADR 0010](0010-ci-runners-and-suites.md) (CI runners and suites) puts them on hosted Linux. Neither picked the tool. Staging does not exist yet, because SKEL-001 (the staging environment) is still waiting.

k6 is a Go binary with scenarios in JavaScript and built-in WebSocket support. It needs its own install step on every Mac and runner, through Homebrew or a setup action. Locust is a Python package with scenarios in Python. It installs through uv like every other Python tool in the repository, runs on Python 3.14 (checked with Locust 2.47 and gevent 26.9), and can import the API's own code, such as the capability signer the room tokens use. It has no WebSocket client of its own.

## Decision

Load tests use Locust, pinned in a separate `load` dependency group in the root `pyproject.toml` with the `websockets` client, so `uv run --group load` installs them on demand and CI jobs that do not load test never download them. The scenarios live in `scripts/load/locustfile.py` as three user classes, `ApiUser`, `TileUser` and `RoomUser`, picked by name on the command line.

The target is always a parameter. Before any user starts, every target URL is checked: localhost and hosts with `staging` in a label pass, one exact host can be allowed through `PARFOCAL_LOAD_ALLOW_HOST`, and everything else, including `parfocal.eu` and production Modal hosts, stops the run.

No CI workflow is added yet. A useful run needs a service token for the API and tiles and a room token key or a member session for realtime, which are new secrets, and staging does not exist. OPS-012 adds a `workflow_dispatch` job once staging and its secrets exist.

## Consequences

The realtime scenario carries its own WebSocket handling, a join timed from connect to open and a ping timed to its pong, reported to Locust by hand. A service token cannot open a room, because room access is for members only, so the realtime scenario needs either a member session cookie or the room token key to sign its own tokens. Switching to k6 later means rewriting three small scenarios, and nothing else depends on Locust.
