# 0325. Uploaded files are parsed in a separate process with a scoped job token, limits and a network block

- Date: 2026-11-15
- Status: Accepted
- Deciders: agent doing SEC-026 (isolated parsing of uploaded files), for the owner to confirm
- Backlog: SEC-026 (isolated parsing of uploaded files). Answers threat U2 (a crafted slide runs code in the worker) in the [threat model](../security/threat-model.md). Builds on [ADR 0241](0241-gpu-worker-pool-limits.md) (GPU worker pool limits)

## Context

The ingest worker opens uploaded slides with OpenSlide, tifffile, wsidicom and Pillow. Those readers are large C and Python code bases fed by files a user controls. Today they run inside the ingest process, which holds the database URL, the storage keys and the login secrets, because the Modal app attaches all three secrets at app level, and which can reach the network. A reader bug that runs code would hand all of that to the attacker. A decompression bomb or a pathological file could also hold the worker for its whole hour or take its memory.

## Options considered

1. Keep parsing in the worker and rely on the structure checks of INGEST-005 (structure checks before any reader). Cheap, but a reader bug still reaches every secret.
2. A separate Modal function with `block_network=True`. Modal 1.6.3 accepts `block_network` on `App.function`, but this app sets its secrets on `modal.App`, so every function in it inherits them. It also needs the file handed across, and every check pays a cold start.
3. A child process inside the worker with an empty environment, a job token, a memory watchdog, a deadline and an audit hook that refuses sockets and program starts, talking to the worker only over its pipes. On Modal a later step runs the same child inside a `modal.Sandbox` created with `block_network=True`.

## Decision

Option 3. It is testable on the Mac and on the Linux CI runner without a Modal account, and the Modal sandbox adds the kernel-level boundary without changing the child.

- `parfocal_ingest.isolation.parse_isolated` starts `python -I` on the file `isolated_child.py`, which imports only the standard library, and hands it the worker's import path in its first message. A child that dies before it has loaded its parser raises `ParseNotStartedError`, which is a worker error and not a refusal, so the upload is kept. It runs in its own session with only `PARFOCAL_JOB_TOKEN`, `HOME`, `TMPDIR` and `PATH` set, inside the job's work folder. The child removes the token from its environment before any parser is imported.
- The token is an HMAC over the tenant, the slide and the exact upload key, signed with a key that lives only in the worker process. The child asks for objects over its stdout and the worker serves a key only when the token verifies and the key is the upload key or under that tenant's slide prefixes. The worker downloads the object and hands back a local path. The child never holds storage credentials.
- The child installs an audit hook (`sys.addaudithook`, which cannot be removed) that raises on socket connect, bind, send and name lookups and on every way of starting a program. This is a tripwire against Python-level code, not a boundary: native code in a reader can call the system directly. The boundary is the Modal sandbox below.
- The worker polls the child's resident memory (from `/proc` on Linux, from `ps` elsewhere) and kills the process group when it passes `ingest_parse_memory_mib` (3072 MiB by default). It kills it at `ingest_parse_seconds` (1800 s by default). These end the check as `parse-too-large` or `parse-too-slow`, permanent failures with their own message. A crash or an unreadable reply ends it as `unreadable`. Kernel address-space limits are not used, because macOS does not enforce them and memory-mapped slides can trip them on legitimate files.
- `ingest_parse_user` names a user to run the child as. It defaults to none, because the Modal containers run as root and a privilege drop there is untested.
- The `identify`, `scan` and `validate` steps parse in the child. Since SEC-045 (isolate the remaining parse steps) so do `index`, `derive`, result file and heatmap parsing in `result_import`, and the slide reads of patch export, one child per slide.
- A child hands larger results back as files in an output folder the worker made for that call. The worker opens only names it chose, with `O_NOFOLLOW` on the folder and the file, refuses anything that is not a regular file, and caps each file at 1 GiB. Cell arrays come back as `.npy` files loaded with `allow_pickle=False` and checked for dtype, length and index ranges. Shapes and counts come back as typed msgpack. Patch tiles come back as a zip whose member names must match the rows exactly. Anything else ends as unreadable or, for patch export, as a skipped slide.
- With `ingest_parse_user` set, the worker hands the job folder and its subfolders to that user before starting the child, so the child can write its outputs.

## Modal side

Since SEC-045 (isolate the remaining parse steps) the ingest function parses in a `modal.Sandbox`, from the first deploy of `parfocal_deploy.modal_app` after it merges. `parse_isolated` takes a launcher from `ParseLimits.launcher`, and the worker loads it from the `INGEST_PARSE_LAUNCHER` setting, which `run_ingest` sets to `parfocal_deploy.parse_sandbox:ingest_launcher`. Without the setting, as on the Mac and in CI, the child is a local process as before. The [probe result](../results/2026-11-16-parse-sandbox-on-modal.md) (a parse in a network-blocked Modal sandbox) has the numbers.

- Each parse call creates one sandbox with `PARSE_SANDBOX_OPTIONS`, which are `block_network=True`, a hard memory limit of `(3072, 3072)` MiB, a 1800 s lifetime and no secrets. The worker runs the unchanged child in it with `exec` and talks to it over the exec's stdin and stdout. Reply lines are capped at 1 MiB as before, and stderr goes nowhere. The sandbox is terminated on every path.
- The sandbox image is the function's own image, taken with `modal.Image.from_id` of the hydrated app image. The parfocal source is now copied into that image (`copy=True`), because source added at container start is not part of the image the sandbox gets.
- The work folder is mirrored at the same absolute path. The worker fetches an allowed object as before and copies it in with `filesystem.copy_from_local` before it replies. It creates the call's output folders in the sandbox. After a result it copies back only plain regular files from those folders, and refuses symlinks, other entry types, names with a slash and anything over the 1 GiB cap, counted per file and per folder, before any download.
- The worker's own deadline ends a check as `parse-too-slow`. A child killed by the sandbox's memory limit ends it as `parse-too-large`. The runner reads exit code 137 from the exec or, when the exec reports none, from the sandbox itself. A file the worker wrote itself, such as the GeoJSON of a patch export, is passed in as a declared input before the child starts. Copy-back checks the listed sizes and then the sizes on disk after each copy.
- Answered: the fetched file reaches the sandbox through the sandbox file API. A per-job `modal.Volume` uploads at a similar rate but would carry the file once per slide rather than once per step. Answered with a [real slide](../results/2026-11-18-parse-sandbox-real-slide.md) (the 1.1 GB `test_001.tif` through the five parse steps): every step passed under these limits, the slowest in 62 s, but the five copies took 81 and 90 percent of the sandboxed time in two runs, 63 and 138 s against 15 s for the same steps as a local child. SEC-051 (carry a slide into the parse sandbox once per job) moves to one sandbox or one per-job Volume per job.
- Answered: inside the sandbox there is no worker process and no secret, so there is no worker environment to read. The parse user is still worth setting where the child runs as a local process. Its test passes as root on Linux with `workers/ingest/scripts/test-as-root.sh`, and it stays skipped in CI, where the runner is not root.
- Answered: the three secrets attach to the `web` and `ingest` functions, and `modal.App` carries none, so a sandbox inherits no secret. The probe found no secret name in the sandbox environment, and a raw socket connect failed without the audit hook.

## Consequences

- Every parse step starts its own sandbox, five per slide, and a container start took 2.2 to 3.3 s in the probe.
- A parser bug no longer finds the database URL or the storage keys in its own environment and cannot ask for another tenant's objects. It still runs as the worker's user, so on Linux it can read `/proc/<worker pid>/environ` and the local work folders of other jobs on the same worker. On Modal the sandbox's own file system and network block close both once this change is deployed. Setting `ingest_parse_user` closes the first where the child runs as a local process.
- New failure codes `parse-too-large` and `parse-too-slow` reach the upload list through the existing failure messages.
