status: review
since: 2026-11-16
note: Not ticked. ci run 43731016201 had all three web shards green, but ci run 43859683421 on main failed worklist-keys.spec.ts:42 on both attempts with an axe color-contrast violation on /tasks/:id/disagreements (a primary button, foreground #d5d5d5 on #467cd9, contrast 2.78, probably caught mid fade). Find why the scan sees that state, then tick after a few green full web runs.
