# 0050. Deploy pipeline and per-pull-request previews on Cloudflare, Modal and Neon

- Date: 2026-10-15
- Status: Accepted
- Deciders: Yurii Fedas (owner standing approval)
- Backlog: STACK-030 (infrastructure as code, deploy and runtime platform). Refines OPS-001 (base infrastructure as code), OPS-002 (deploy definitions), OPS-003 (environments) and OPS-005 (continuous deployment). Amends the "Pages" part of [ADR 0003](0003-pilot-platform-architecture.md).

## Context

[ADR 0003](0003-pilot-platform-architecture.md) set the default for this slot: no Kubernetes, Wrangler config for the edge, Modal app code for Python, the Neon API for branches, GitHub Actions for deploys, and a small OpenTofu module for DNS, buckets and the Zitadel and Neon projects. It also promised "a preview per pull request" without saying how one is built. STACK-030 is done when the record covers previews for the web app and the API.

This is a paper decision. Nothing was deployed or created while writing it, because the cloud is paused ([knowledge/platform.md](../knowledge/platform.md)). Every vendor fact below was read on 2026-10-15 from the vendor page named in the sources. Anything not found there is marked `TODO`.

Facts that shape the design.

| Fact | Source |
|---|---|
| A Worker version URL (`wrangler versions upload --preview-alias`) is not generated for a Worker that implements a Durable Object. The edge Worker has Durable Objects for realtime | Cloudflare version URL docs |
| A Worker can serve static assets with an `assets` binding, and `assets.run_worker_first` takes `true` or a list of route patterns | Cloudflare static assets docs |
| Workers per account: 100 on Free, 500 on Paid. Static asset files per version: 20,000 Free, 100,000 Paid | Cloudflare Workers limits |
| Neon branches per project: 10 on Free and Launch, 25 on Scale. Extra branches cost $1.50 a branch-month on Launch and Scale. The Free plan gives 100 CU-hours per project a month and 1 GB per project | Neon plans page |
| A Neon branch can carry `expires_at`, at most 30 days ahead, and is deleted by Neon at that time. A branch with children cannot expire | Neon branch expiration docs |
| Modal environments are isolated, each has its own secrets, and a workspace can have up to 1500. `modal environment delete` removes every app inside | Modal environments and CLI docs |
| Modal Starter: 100 containers, 10 GPU concurrency, 5 deployed crons, 200 deployed apps. No numeric limit for web endpoints or environments is published | Modal pricing page |
| A Modal web function URL is `https://<workspace-and-env-suffix>--<app>-<function>.modal.run`, cut to 63 characters per label | Modal web URL docs |
| Zitadel accepts glob patterns in redirect URIs only for an application in development mode | Zitadel application docs |
| GitHub passes no secrets except `GITHUB_TOKEN` to a workflow triggered from a fork | GitHub secrets docs |
| The repository is public and the owner pushes to `main` directly under a ruleset that requires `ci-ok` with admin bypass | [knowledge/agent-tooling.md](../knowledge/agent-tooling.md) |

## Options considered

### Runtime platform and infrastructure as code

1. Cloudflare, Modal and Neon driven by Wrangler, the Modal CLI, the Neon API and GitHub Actions, with OpenTofu only for durable resources. This is the ADR 0003 default. Previews are cheap and scale to zero, but there are three vendor CLIs to script.
2. Everything in OpenTofu, including per-pull-request resources. One tool, but Modal has no provider we trust, state churns on every pull request, and a failed apply would block unrelated pull requests.
3. Pulumi instead of OpenTofu. Real programming language, but a new state vendor for a few dozen resources. ADR 0003 already rejected it.
4. Kubernetes with Helm and Argo CD, one namespace per pull request. Strongest isolation and a familiar pattern, but it needs an always-on cluster, a node bill and an operator, which breaks the one-developer constraint. It is kept as a revisit trigger.
5. A container platform such as Cloud Run or ECS. Fewer moving parts than Kubernetes but adds a fourth vendor and still has no cheap GPU story.

### Preview of the web app and edge

1. Cloudflare Pages preview deployments for the web app and Worker version URLs for the router. Version URLs are not generated for a Worker with Durable Objects, and the SPA and the Worker would be two origins.
2. One Worker per pull request that serves the SPA assets and runs the router and Durable Objects, deployed with `wrangler deploy --name parfocal-edge-pr-<number>`. One origin like production, Durable Object state isolated by Worker name, no dependence on version URLs. It counts against the account's Worker limit.
3. Workers Builds for non-production branches. It posts a preview URL, but the docs read do not state build minutes, pull request behaviour or secret handling, so it cannot carry the secret and teardown rules below.

### Preview of the API and database

1. One shared preview API and database for all pull requests. Cheap, but pull requests overwrite each other and migrations collide.
2. A Modal environment per pull request. Strong isolation of secrets, but the web suffix needed for unique URLs, the environment limit on Starter and the secret copy per environment are all unverified.
3. One shared Modal environment `preview` with one app per pull request (`parfocal-api-pr-<number>`) and one named secret per pull request. Isolation by app name, deletion by `modal app stop`, and only two Modal objects per pull request to clean.
4. A Neon branch per pull request in the production project. Branch quota and CU-hours would be shared with production and staging.
5. A Neon branch per pull request in a separate preview project. Production and staging quotas stay untouched. One more project to create.

### Secrets in previews

1. Copy production and staging secrets into previews. Fast, but a leaked preview leaks production.
2. Preview-only credentials, generated or provisioned for previews and stored in a GitHub environment `preview`. Nothing from production ever reaches a preview.
3. Fork pull requests get previews too, through `pull_request_target`. GitHub's own guidance warns that these workflows are privileged and can take over a repository.

## Decision

Option 1 for the platform, option 2 for the edge preview, option 3 for the Modal side, option 5 for the database, option 2 for secrets and no previews for fork pull requests.

### Roles of each tool

| Tool | Owns |
|---|---|
| OpenTofu in `infra/tofu` | Durable resources only. R2 buckets, the Zitadel project and one OIDC application per long-lived environment, DNS records, and the R2 lifecycle rule for preview prefixes. Per-pull-request resources are never in the state |
| Wrangler | The `apps/edge` Worker including the built `apps/web` assets, one Worker per environment and one per pull request |
| Modal CLI and app code | The FastAPI app, ingest and ML functions in a thin deploy module (ADR 0003 rule 1), one app per pull request |
| Neon API and CLI | Branches of the preview project, created and deleted by the workflows |
| GitHub Actions | Orchestration, secrets, the pull request comment and teardown |

TODO: decide in OPS-001 (base infrastructure as code) whether the Neon projects move under OpenTofu. The preview project does not need to wait for that, because its branches are runtime objects.

### Amendment to ADR 0003: web assets served by the edge Worker

The SPA is built by `apps/web` and uploaded as the `assets` of the `apps/edge` Worker in every environment. The Worker uses `run_worker_first` with a list of patterns for `/api/*`, `/tiles/*` and `/rt/*`, and the `single-page-application` not-found handling for the rest. This replaces the separate Pages project of ADR 0003. The browser still sees one origin with COOP, COEP and CORP set by the Worker. TODO: confirm in a local `wrangler dev` run that the pattern list accepts `/api/*` and that assets served directly still get the isolation headers, because the pages read show only a literal path as an example.

### Environments

| Environment | Worker name | Python app | Database | Trigger |
|---|---|---|---|---|
| Preview | `parfocal-edge-pr-<n>` | `parfocal-api-pr-<n>` in Modal environment `preview` | Branch `pr-<n>` of Neon project `parfocal-preview` | Pull request opened, updated or reopened |
| Staging | `parfocal-edge-staging` | `parfocal-api` in Modal environment `staging` | Neon project `parfocal`, branch `staging` | Push to `main` |
| Production | `parfocal-edge` | `parfocal-api` in Modal environment `main` | Neon project `parfocal`, branch `main` | Tag `vX.Y.Z` ([ADR 0014](0014-conventional-commits-and-releases.md)) after approval |

Wrangler config has one `env` block each for staging and production. Preview deploys use the staging block with `--name` and `--var` overrides, so the preview artifact has the same shape as the others.

### Preview creation

A workflow `preview.yml` runs on `pull_request` (`opened`, `reopened`, `synchronize`) only when the head repository is this repository. It uses the GitHub environment `preview`, one concurrency group per pull request that cancels older runs, and a path filter on `apps/web`, `apps/edge`, `apps/api`, `workers` and `packages`. The steps are below.

1. Check the cap. The preview project has 10 branches on the Free plan, one of which is the base branch, so at most 5 previews run at once and the workflow fails with a clear message beyond that. The cap leaves room for the base and a few leaked branches.
2. Create or refresh the Neon branch `pr-<n>` from the branch `base` of the preview project with `expires_at` set 7 days ahead, which each push moves forward. `base` holds the migrated schema and the seeded fake data, and it is rebuilt by a workflow when `main` changes migrations. It is a parent, so it never expires.
3. Run `alembic upgrade head` from the pull request code against the direct (unpooled) connection string of the branch, then run the seed script for fake data only. The API at runtime uses the pooled connection string and `SET LOCAL` ([knowledge/platform.md](../knowledge/platform.md)).
4. Create or overwrite the Modal secret `parfocal-pr-<n>` in environment `preview` with `modal secret create --force`, then run `modal deploy` for app `parfocal-api-pr-<n>`. The app is deployed without the orphan-resumer cron, because Starter allows 5 deployed crons ([ADR 0044](0044-background-jobs-and-workflows.md)). Previews run steps in-process or are resumed by a manual call. Containers scale to zero.
5. Build `apps/web` with the preview public variables, then run `wrangler deploy --name parfocal-edge-pr-<n>` with `--var API_ORIGIN=<modal url>` and `--var STORAGE_PREFIX=previews/pr-<n>/`, and upload the Worker secrets with `wrangler secret bulk`.
6. Wait for `/api/health` through the Worker, then post or update one sticky pull request comment with the Worker URL, the Modal app name and the Neon branch name, and set the GitHub deployment status for the environment `preview`.

The Worker URL is `https://parfocal-edge-pr-<n>.<subdomain>.workers.dev`, a single label below the account subdomain. The Modal URL follows `https://<source>--parfocal-api-pr-<n>-web.modal.run`, about 45 characters per label with the names planned here, which is under the 63 character limit. TODO: read the account's `workers.dev` subdomain and the web suffix of the Modal environment `preview` (the workspace has several environments, so at most one can have an empty suffix) before OPS-003 (environments) is built.

Storage uses the existing `parfocal-dev` bucket ([ADR 0004](0004-cloud-dev-resources.md)). Seeded slides are read from the shared `fixtures/` prefix. Uploads made in a preview are written under `previews/pr-<n>/`, and the Worker adds the prefix from `STORAGE_PREFIX` so the key layout of ADR 0003 stays inside it.

`APP_ENV=preview` follows [ADR 0005](0005-external-sends-only-in-production.md). Email goes to the console sender, so an invitation link in a preview is read from the Modal app logs, and nothing is sent to Resend, Sentry, Grafana Cloud or PostHog.

### Preview login

Zitadel allows glob redirect URIs only for an app in development mode. OpenTofu gains one more OIDC application, `parfocal-api-preview`, in development mode, with the redirect URI `https://parfocal-edge-pr-*.<subdomain>.workers.dev/api/auth/callback` and the matching post-logout pattern. The long-lived dev, staging and production apps stay strict. Every preview shares this one application and the e2e test user, so no per-pull-request Zitadel call is made. TODO: test that `*` does not cross a dot, and what the provider does with the glob, in a plan before relying on it.

### Secrets

Secrets reach previews only through the GitHub environment `preview`. The workflow reads them as environment secrets and writes them to the vendors at deploy time.

| Secret | Origin | Where it ends up |
|---|---|---|
| Cloudflare API token for previews | Account token limited to Workers Scripts write and R2 write on `parfocal-dev`, held in the environment `preview` | The job, for Wrangler |
| Modal token | Token of a workspace member, held in the environment `preview` | The job, for the Modal CLI |
| Neon API key and preview project ID | Key from the Neon console, project ID as a variable | The job, for Neon calls |
| `DATABASE_URL` of the branch | Returned by the Neon API for `pr-<n>` | Modal secret `parfocal-pr-<n>` only |
| Session key, master key for envelope encryption, capability signing key | Generated fresh for each pull request with a random 32 bytes | The Modal secret, and the capability signing key also the Worker secrets, so the router can verify tokens the API signs |
| Zitadel client ID and secret of `parfocal-api-preview` | OpenTofu outputs, stored once in the environment `preview` | Modal secret `parfocal-pr-<n>` |

Production and staging credentials are in the environments `staging` and `production`, which preview jobs cannot read. The master key of a preview is thrown away with it, which is acceptable because preview data is fake. Fork pull requests get no preview, because GitHub withholds secrets from them, and `pull_request_target` is not used. A reviewer can check out a fork branch into a same-repository branch to get one.

An accepted weakness: Cloudflare account tokens cannot be limited to Worker names, so the preview token could also overwrite the production Worker. Anyone who can push a branch to this repository can run the workflow with it. With one owner this is acceptable. It is a revisit trigger below.

### Teardown

Three layers, because a missed webhook must not leave cost behind.

1. A workflow on `pull_request` `closed`, which runs for both merged and abandoned pull requests, deletes in this order: `wrangler delete --name parfocal-edge-pr-<n>`, `modal app stop -y -e preview parfocal-api-pr-<n>`, `modal secret delete -y --allow-missing -e preview parfocal-pr-<n>`, the Neon branch `pr-<n>`, and the R2 objects under `previews/pr-<n>/` through the S3 API. Each step tolerates a missing resource, so a rerun is safe.
2. A scheduled workflow every night lists open pull requests with `gh` and deletes every `pr-<n>` Worker, Modal app, secret, Neon branch and prefix whose pull request is closed or missing.
3. Backstops owned by the vendors. The Neon branch expires 7 days after the last push because of `expires_at`. An R2 lifecycle rule in OpenTofu expires objects under `previews/` after 14 days, and R2 removes them within about 24 hours of that time.

TODO: confirm whether `wrangler delete` also removes the Durable Object storage of the Worker and whether it frees the Worker name, because the pages read do not say. If it does not, the nightly sweep must delete the namespaces through the API.

### Staging and production pipeline

The preview pipeline is the same code path with different targets. OPS-005 (continuous deployment) fills in the details.

| Step | Order |
|---|---|
| 1 | CI is green (`ci-ok`) on the commit or tag |
| 2 | Migrate the database with expand-then-contract migrations, so the previous API version still works against the new schema |
| 3 | Deploy the Modal app |
| 4 | Build the web app and deploy the Worker with its assets, then run a smoke check |
| 5 | Production only: wait for approval on the GitHub environment `production` before step 2 |

Rollback uses `modal app rollback` for the API and a previous Worker version for the edge. Both are drilled on staging in OPS-005. Secrets for staging and production live in their own GitHub environments and are written to Modal and Wrangler by the deploy job. TODO: GitHub OIDC is not used because neither Cloudflare nor Modal publishes a federation path that was found in the pages read, so long-lived tokens are used and rotated by hand until that changes.

## Consequences

- A pull request gets a working URL with a seeded database, a separate API and an isolated Durable Object namespace, all from git and scripts. Closing it removes the Worker, app, secret, branch and prefix.
- The web app is no longer deployed to Pages. ADR 0003 stays accepted, and this record is the change for the Pages part. [knowledge/local-dev.md](../knowledge/local-dev.md) still lists Pages in the production column and needs the same edit when OPS-002 (deploy definitions) lands.
- The preview project adds one Neon project. It is on the Free plan, so previews also share a 100 CU-hour budget and suspend after 5 minutes idle. The first request to a preview after a pause waits for the database to wake.
- Previews cannot be created while the Modal spend limit blocks deploys ([knowledge/platform.md](../knowledge/platform.md)). Until the owner fixes the cloud, nothing in this record is built.
- Cloudflare Free allows 100 Workers per account. With Workers Paid (planned in ADR 0003) the limit is 500, which is far above the 5 preview cap.
- Backlog changes: OPS-002 and OPS-003 gain the names and rules above. STACK-030 can be ticked once this record is merged. The edits to those tasks and to the indexes are done by the person who ticks it.

### Triggers that reopen this decision

| Trigger | Action |
|---|---|
| More than 5 concurrent pull requests are normal | Move the preview project to the Neon Launch plan and pay $1.50 a branch-month for extra branches, or raise the cap |
| A second committer or outside contributors need previews | Split the Cloudflare account so previews cannot touch production, require reviewers on the environment `preview`, or build previews for fork pull requests through a two-workflow design that never runs fork code with secrets |
| Cloudflare ships version URLs for Workers with Durable Objects | Replace one Worker per pull request with `wrangler versions upload --preview-alias pr-<n>` and drop the Worker limit concern |
| Account Worker count nears the plan limit, or Modal publishes a web endpoint or app limit that previews hit | Share one preview Worker per environment, or ask Modal for higher limits |
| A component needs an always-on process that serverless cannot run (a self-run workflow engine, a stateful search or realtime server) or API to database latency breaks the budgets in ADR 0003 | Reopen Kubernetes or a fixed container host. For Kubernetes, use a namespace per pull request created from an Argo CD ApplicationSet, sized by the measured preview count, and write a new ADR |
| First tenant with real PHI | Previews must keep using fake data only. Add region-pinned staging, separate accounts for previews and the ADR 0003 PHI actions |
| Preview start time is above the budget the owner sets | Keep the Neon preview computes warm for open pull requests, or pre-build the Worker artifact in CI and only change the name and variables |

## Sources

- Cloudflare Worker version URLs and the Durable Object exclusion: https://developers.cloudflare.com/workers/configuration/previews/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare static assets and `run_worker_first`: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- Wrangler `deploy`, `delete`, `secret bulk` and `versions upload`: https://developers.cloudflare.com/workers/wrangler/commands/workers/
- `workers.dev` URL format: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- R2 object lifecycles: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Neon plans and limits: https://neon.com/docs/introduction/plans
- Neon branch expiration: https://neon.com/docs/guides/branch-expiration
- Neon GitHub Actions for branches: https://neon.com/docs/guides/branching-github-actions
- Modal environments: https://modal.com/docs/guide/environments
- Modal environment, app and secret CLI: https://modal.com/docs/reference/cli/environment, https://modal.com/docs/reference/cli/app, https://modal.com/docs/reference/cli/secret
- Modal web function URLs: https://modal.com/docs/guide/webhook-urls
- Modal pricing: https://modal.com/pricing
- Zitadel redirect URIs and development mode: https://zitadel.com/docs/guides/manage/console/applications
- GitHub secrets and forks: https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
- GitHub secure use of workflows: https://docs.github.com/en/actions/reference/security/secure-use
