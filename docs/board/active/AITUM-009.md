status: review
by: claude parallel run
since: 2026-11-16
note: Its two Done tests exist. The db job still fails on the train because tests/test_tenant_isolation_writes.py did not list the operation scoreViewMapTile, and pull request 12 now names it as probed in test_view_maps.py. Tick once a db job shows test_every_operation_of_every_method_is_in_the_suite passing. The db job also fails test_a_10k_cell_import_through_the_real_worker_stays_within_budget of RSET-012 after waiting 30 minutes, which does not belong to this task.
