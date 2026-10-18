# 0081. Uploads are checked by structure, without an antivirus scanner

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-005, INGEST-004, INGEST-006, SEC-015

## Context

INGEST-005 asks for a malware and integrity scan: an EICAR test file is rejected and a truncated TIFF fails validation with a user-readable error. ClamAV, the usual free scanner, refuses files above a configurable limit that cannot go past about 2 to 4 GB, while slides reach 7 GB (`Hamamatsu-1.ndpi`). Slides are images that Parfocal opens with its own readers and never executes or serves as anything but tiles and derived images. Running ClamAV also means a signature database of several hundred MB in every worker image and daily updates. The owner chose on 2026-10-18.

## Options considered

1. ClamAV on every file up to its limit and on every zip in full, with structure checks for larger slides. Catches known malware in small files, but the largest files, where a hidden payload would fit best, are not scanned, and every worker carries the scanner.
2. Structure checks only. Every upload must be a slide or result file that Parfocal can read, with every stored byte range inside the file. Anything else is refused. No extra service, no size limit, nothing more runs in the cloud.
3. ClamAV, refusing what it cannot scan. Safest against known malware, but large slides cannot be uploaded at all.

## Decision

Option 2, as the owner chose.

- Identification (INGEST-004) refuses any file that is not a supported slide or archive, which includes executables, scripts and the EICAR test file.
- `parfocal_ingest.integrity` checks that every tile or strip of every page lies inside the file, and every member of a zip passes its CRC check. A failure is refused as truncated or damaged with a plain reason.
- The level table (INGEST-006) then has to be consistent, so a file that only looks like a slide is refused before any pixel is served.
- Files are never executed, never served in their original form to browsers other than as slide bytes read by the viewer, and never opened by software outside the readers named in ADR 0043.

## Consequences

- INGEST-005 is built on the structure checks and its "Done when" stays as written: the EICAR file is refused as not a slide, and a truncated TIFF fails the integrity check.
- If a customer contract requires antivirus scanning, ClamAV can be added in front of the structure checks for files under its limit. That needs a new ADR (SEC-015).
- Result files (RSET-003) are parsed, never executed, and errors name the feature or row.
