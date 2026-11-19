# Result: mock views a signed-in person can reach on the deployed app

- Date: 2026-11-20
- Backlog: PROTO-079 (the deployed app carries no prototype scenes or mock views)
- Kind: baseline
- Commit: the PROTO-079 commit that adds this file
- Environment: source of `apps/web` read on the owner's Mac, and the deployed build config rebuilt by `apps/web/e2e/production-scenes.spec.ts`
- Data: none, the fake API seed only

## Question

The owner wrote on 2026-11-19 that the deployed app must not show mock views. Which prototype scenes and mock routes can a signed-in person still reach on `app.parfocal.eu`, what does each show, is there real data and a real API behind it, and what happens to each one?

The calls are (a) make it real now, (b) keep it only behind dev tools, which the deployed build turns off, and (c) delete it as dead history.

## Method

1. Read how the deployed build is made. `workers/deploy/src/parfocal_deploy/deploy.py` runs `pnpm --filter @parfocal/web build` with only `PARFOCAL_PUBLIC_APP_ENV=prod`. `PARFOCAL_PUBLIC_DEV_TOOLS` and `PARFOCAL_PUBLIC_FAKE_API` are not set, so `apps/web/vite/dev-tools.ts` resolves dev tools to off and `src/config.ts` resolves the fake API to off. A prod build refuses `PARFOCAL_PUBLIC_DEV_TOOLS=on`. `infra/app-environments.json` lists `app.parfocal.eu` as a development environment, which changes who may reseed it but not the build flags.
2. Listed every file in `apps/web/src/routes` and every `scene` search field in `apps/web/src/search/route-searches.ts`, with the scenes each one keeps when dev tools are off. `apps/web/test/scene-gate.test.ts` now holds that list and fails when it drifts.
3. Grepped `apps/web/src` for every other way to read a scene from the address (`search["scene"]`, `.get("scene")`, `scene: z.`).
4. Opened each mock route and a sample of scenes on a build made with the deployed config, in `e2e/production-scenes.spec.ts`.

## Results

### Mock routes

None of these are in the deployed route tree. The production build points the router generator at a second tree that ignores their files, and each route also throws not found when dev tools are off.

| Route | What it shows | Real data or API | Call |
| --- | --- | --- | --- |
| `/prototype` | The index of every prototype scene in 11 screens, from the `prototype-scenes.ts` files | No, fake API only | (b) |
| `/flow-map`, `/flow-map/walkthrough`, `/flow-map/walkthrough/$chapter` | The design flow map and its guided walkthrough | No, fake API only | (b) |
| `/issue-states` | A gallery of every error and empty state | No, fake API only | (b) |
| `/issue-pages/$kind` | Each full-page issue, such as not found or no access | No | (b) |
| `/spikes/hotkeys`, `/spikes/input-traces`, `/spikes/worklist` | Measurement spikes for hotkeys, input traces and a 50,000 row worklist | No | (b) |
| `/kpi` | Task timing from timing events recorded in this browser, and a seeded sample when there are none | Local events only, no API | (b), moved behind dev tools by this task |

Nothing is (c). The browser suite opens every one of these routes in about 50 specs, so they stay as test harnesses in the dev tools build.

### Product routes that stay in the deployed build

`/developer` is the researcher developer drawer. It reads the real `/api/me` and refuses anyone who is not a researcher, so it is a real feature and stays. `/popout` is the real minimap and inspector window, `/study` is the real usability study mode on the real API, and both stay. The debug handle on `window` does not depend on dev tools. Turning dev tools off on the deployed build therefore hides nothing the owner uses.

### Scenes

Every `scene` value is read through `sceneField` in `route-searches.ts`. Until this task a scene ran whenever the fake API was on. It now runs only when dev tools and the fake API are both on, so a dev build without dev tools ignores scenes too. With dev tools off, a scene field keeps only the values a real control writes, listed below. Every other value is dropped and the screen opens on real data.

| Route | Scenes kept on the deployed build, all written by real controls | Mock scenes dropped there | Call for the dropped scenes |
| --- | --- | --- | --- |
| `/admin` | `tplnew`, `tpledit`, `addmodel`, `addtested`, `addfail`, `addmap` (template editor and connect-a-model wizard steps) | 10 section previews | (b) |
| `/invite` | `landing`, `account` | none | |
| `/sign-in` | `email`, `sso`, `forgot`, `reset`, `passkey`, `passkeyqr`, `lock`, `lockkey` | `expired`, `noaccess` | (b) |
| `/sign-up` | `form`, `verify` | none | |
| `/projects/$projectId/slides/$slideId` and `/popout` | `objects`, `picking`, `picked`, `travel` | 32 viewer states such as `running`, `slidefail`, `heat`, `swipe` | (b) |
| `/projects/$projectId/slides/$slideId/annotate` | `auto`, `models` | none | |
| `/projects/$projectId/upload` | `empty`, `files`, `check`, `progress`, `done` | 11, such as `dup`, `storagefull`, `unmatched`, `sourceoff` | (b), see follow-ups |
| `/tasks/$taskId/evaluation` | `report`, `arrange`, `pdf` | `retiredtpl`, `exportfail` | (b) |
| `/tasks/$taskId/guided` | `region` | 23, such as `withdrawn`, `signedoff`, `slidefail`, `noresults`, `locked` | (b), see follow-ups |
| `/team` | `reassign`, `nudge`, `signoff` | 6 | (b) |
| `/`, `/my-work`, `/developer`, `/setup`, `/settings/$section`, `/projects/$projectId`, `/projects/$projectId/run-model`, `/projects/$projectId/tasks/new`, `/projects/$projectId/cases/$caseId/report`, `/projects/$projectId/cases/$caseId/co-sign`, `/projects/$projectId/slides/$slideId/annotate-task`, `/tasks/$taskId/cells`, `/tasks/$taskId/sign-off` | none | all | (b) |

The 11 `prototype-scenes.ts` files are imported only by `/prototype` and one unit test, so they are already absent from the deployed bundle. `test/bundle.test.ts` checks that a dev, staging and prod build holds no fake API and no developer route.

No other source file reads a scene from the address outside `src/fake-api`, `src/flow-map` and the developer routes.

## Interpretation

The deployed app already showed no mock route and ignored mock scenes, because PROTO-027 (the scene harness is not reachable in the deployed app) tied scenes to the fake API, which a prod build refuses. The gap this task closes is that the gate was the fake API alone, so any build with the fake API on and dev tools off would still have honoured scenes over a real backend. The gate is now dev tools, `/kpi` with its seeded sample moved behind it, and two tests hold the line: the unit test lists every route and every kept scene, and the browser spec builds with the deployed config and finds every mock route not found.

Some mock scenes show states the real screens may not yet reach from real data. They are hidden on the deployed app, not built, so they are listed as follow-ups. This task did not check each real path end to end, so each follow-up starts by checking whether the real screen already reaches the state.

## Follow-ups

- TODO task: Task timing page reads recorded timing events from the API instead of a seeded sample, which would bring `/kpi` back as a real researcher page.
- TODO task: Guided review shows withdrawn, signed off, slide failed and no results from the real task state, which the `withdrawn`, `signedoff`, `slidefail` and `noresults` scenes only fake today.
- TODO task: Upload warns about a duplicate slide, an unmatched file and full storage from the real upload API, which the `dup`, `unmatched` and `storagefull` scenes only fake today.
- TODO task: Sign-in shows an expired link and a no access page from the real auth answers, which the `expired` and `noaccess` scenes only fake today.
