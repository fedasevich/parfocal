# 0263. A lab model is a saved endpoint with a separate test call, link import address rules and a token sealed with the tenant data key

- Date: 2026-11-08
- Status: Accepted
- Deciders: Yurii Fedas (to confirm), proposed by the agent building JOBS-005 (connect a lab model)
- Backlog: JOBS-005 (connect a lab model), shapes ADMIN-005 (AI models) and any later task that runs a connected lab model on slides

## Context

JOBS-005 (connect a lab model) lets a researcher with admin rights point Parfocal at the lab's own HTTP server, test it with a sample tile, map its classes and choose who may run it. The threat model rows J1 (the endpoint turns the job runner into a request forgery tool), J2 (endpoint credentials leak from the database or logs) and J3 (tiles of a clinical project go to a server nobody expected) set the guards. The mock `admin/addmodel` already fixes the contract: Parfocal sends one tile as a base64 PNG with its size, magnification and level 0 origin, and the server answers its model name, version and objects, each with a kind, a class and a polygon. INGEST-025 (import slides from a link) already has `parfocal_common.link_fetch`, which refuses any scheme but HTTPS, resolves the host and refuses private, link-local and mapped addresses, pins the address it checked, and caps size and time.

Three choices were open: how the test relates to saving, which tile the test sends, and how the token is kept.

## Options considered

Test and save:

1. Saving runs the test call again and refuses a server that does not follow the contract. Saving can then not store a server that is down for a moment, and every save sends a tile.
2. A separate test route answers what came back, and saving checks only the address rules and the class map. The screen enables saving only after a passing test.

The tile sent by the test:

1. A real tile from one of the workspace's slides, as the mock's wording "sample tile from tumor_009" suggests. That sends clinical image data to a server before anyone has said which projects may use it, which J3 forbids.
2. A synthetic tile drawn in code with stain-like colours, the same for every workspace, with no patient data.

The token:

1. Hashed, like API tokens. A hash cannot be sent to the lab's server, so this does not work.
2. Encrypted with the platform master key. Every tenant's tokens would then fall to one key, and erasing a workspace would not make them unreadable.
3. Sealed with the tenant data key through `seal_field` in `parfocal_api.identifiers`, the envelope patients already use, bound to the table, row and field so a ciphertext cannot move to another row.

## Decision

`POST /api/tenant/models/test` (`testLabModel`) sends one synthetic tile and answers `follows-contract` or `not-contract` with the model, the objects found, the classes with suggested matches and the number of objects without a polygon. A refused address, a redirect, an error status, a timeout or an answer over 8 MiB is a 400 problem `lab-model-refused`. `POST /api/tenant/models` (`connectLabModel`) checks the address rules again, checks that every mapped class is in the chosen taxonomy template and that every listed project is in the workspace, and stores the server in `lab_models` with its projects in `lab_model_projects` (migration 0102, lab models). `GET /api/tenant/models/{model_id}` (`getLabModel`) shows it with only the last four characters of the token, and `POST /api/tenant/models/{model_id}/test` (`testConnectedLabModel`) opens the sealed token and calls the server again. All four need the `integrations` permission, which only researchers with admin rights hold, and test and connect are audited as `lab-model.tested` and `lab-model.connected` with the host and never the token or the answer.

Every call goes through `parfocal_common.lab_model_call.call_endpoint`, which applies `target_of` from link import before each request, sends with `follow_redirects=False` and refuses any 3xx, so a model run can use the same function later and meet J1 on every call. The token is registered as a sensitive value before it is sent, so the log scrubber hides it. Origins in `link_trusted_origins` may use plain HTTP and local addresses, which only tests and local development set.

## Consequences

- A token survives only as long as the tenant data key, so erasing a workspace makes it unreadable together with its patients, and rotating the data key needs no change here because `open_field` reads every key version.
- A header sign-in is typed as `Name: value` in the one secret field of the mock, and the browser splits it into `header_name` and `secret`.
- The test shows one synthetic tile, so the mock's second sample tile appears only on fake data.
- Running a connected model on slides, editing or removing one, and listing lab models next to the catalogue are not built yet. ADMIN-005 (AI models) and a later model run task build on `lab_models`.
