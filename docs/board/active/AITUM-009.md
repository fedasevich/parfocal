status: review
by: claude parallel run
since: 2026-11-16
note: The db job is red on the train and on pull request 12 because tests/test_tenant_isolation_writes.py did not list the operation scoreViewMapTile, which pull request 12 now names as probed in test_view_maps.py. The same db job also fails test_a_10k_cell_import_through_the_real_worker_stays_within_budget of RSET-012, which waits 30 minutes for the import to finish. Tick when a db job passes with both fixed.
