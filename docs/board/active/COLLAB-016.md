status: in-progress
by: claude parallel run
since: 2026-11-08
note: Branch worktree-agent-a978fbc6012a707d1 has the batching, changes marker and fake colleague events committed, but its merge hung pnpm -s verify for 43 minutes in the node tests of apps/web and packages/api-client, likely a BroadcastChannel or timer left open by the fake colleague events. Next step: close those handles in the node tests, run verify and the annotate specs, then merge.
