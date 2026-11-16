status: review
by: claude parallel run
since: 2026-11-15
note: browsers.yml exists only on the train, and GitHub only lets workflow_dispatch run a workflow that is on main, so no run was possible. After the train merges, run gh workflow run browsers --ref main and tick when the matrix and its summary come out.
