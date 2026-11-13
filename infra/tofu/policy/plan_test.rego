package plan_test

import data.plan
import rego.v1

change(type, actions) := {"address": sprintf("module.environment.%s.x", [type]), "mode": "managed", "type": type, "change": {"actions": actions}}

test_additive_plan_passes if {
	count(plan.deny) == 0 with input as {"resource_changes": [
		change("cloudflare_r2_bucket_cors", ["create"]),
		change("zitadel_application_oidc", ["update"]),
		change("cloudflare_r2_bucket", ["no-op"]),
	]}
}

test_empty_plan_passes if {
	count(plan.deny) == 0 with input as {}
}

test_delete_fails if {
	count(plan.deny) == 1 with input as {"resource_changes": [change("cloudflare_r2_bucket", ["delete"])]}
}

test_replace_fails if {
	count(plan.deny) == 1 with input as {"resource_changes": [change("zitadel_application_oidc", ["delete", "create"])]}
}

test_create_before_destroy_fails if {
	count(plan.deny) == 1 with input as {"resource_changes": [change("zitadel_application_oidc", ["create", "delete"])]}
}

test_paid_resource_type_fails if {
	count(plan.deny) == 1 with input as {"resource_changes": [change("cloudflare_workers_kv_namespace", ["create"])]}
}
