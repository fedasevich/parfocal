# XXXX. Uploaded files are parsed in a separate process with a scoped job token, limits and a network block

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

- `parfocal_ingest.isolation.parse_isolated` starts `python -I -m parfocal_ingest.isolated_child` in its own session with only `PARFOCAL_JOB_TOKEN`, `HOME`, `TMPDIR` and `PATH` set, inside the job's work folder. The child removes the token from its environment before any parser is imported.
- The token is an HMAC over the tenant, the slide and the exact upload key, signed with a key that lives only in the worker process. The child asks for objects over its stdout and the worker serves a key only when the token verifies and the key is the upload key or under that tenant's slide prefixes. The worker downloads the object and hands back a local path. The child never holds storage credentials.
- The child installs an audit hook (`sys.addaudithook`, which cannot be removed) that raises on socket connect, bind, send and name lookups and on every way of starting a program. This is a tripwire against Python-level code, not a boundary: native code in a reader can call the system directly. The boundary is the Modal sandbox below.
- The worker polls the child's resident memory (from `/proc` on Linux, from `ps` elsewhere) and kills the process group when it passes `ingest_parse_memory_mib` (3072 MiB by default). It kills it at `ingest_parse_seconds` (1800 s by default). These end the check as `parse-too-large` or `parse-too-slow`, permanent failures with their own message. A crash or an unreadable reply ends it as `unreadable`. Kernel address-space limits are not used, because macOS does not enforce them and memory-mapped slides can trip them on legitimate files.
- `ingest_parse_user` names a user to run the child as. It defaults to none, because the Modal containers run as root and a privilege drop there is untested.
- The `identify`, `scan` and `validate` steps parse in the child. `index` and `derive`, result file parsing in `result_import` and patch export still read files in the worker. Moving them is follow-up work, and they only run after `validate` has opened the same file in the child.

## Modal side

`PARSE_SANDBOX_OPTIONS` in `parfocal_deploy.modal_app` holds the settings the sandbox will be created with: `block_network=True`, a hard memory limit of `(3072, 3072)` MiB and a 1800 s lifetime, with no secrets. A test checks every name against `modal.Sandbox.create` in the installed Modal 1.6.3, which also offers `outbound_cidr_allowlist` and `outbound_domain_allowlist`. They cannot be combined with `block_network`, and they are not needed while the worker fetches objects for the child. Nothing is deployed or started by this change.

- TODO: how the fetched file reaches the sandbox (a per-job `modal.Volume` or writing it through the sandbox file API) is not measured, and it decides the cost per check.
- TODO: `Sandbox.create` has no user parameter in Modal 1.6.3, so a non-root child needs the image to add a user and the child command to switch to it.
- TODO: move the app-level secrets onto the functions that need them, so no function of this app inherits them by default.

## Consequences

- Every slide pays three extra Python starts, about a second each with the readers imported. The isolation tests take about 12 s.
- A parser bug no longer sees the database URL, the storage keys or another tenant's objects in storage through Python. It can still read the local work folders of other jobs on the same worker, which the sandbox's own file system removes. Until the Modal sandbox is wired, native code in a reader can still open sockets in production.
- New failure codes `parse-too-large` and `parse-too-slow` reach the upload list through the existing failure messages.
