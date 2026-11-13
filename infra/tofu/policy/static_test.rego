package static_test

import data.static
import rego.v1

backend(root) := {"terraform": [{
	"required_providers": [{"cloudflare": {"source": "cloudflare/cloudflare", "version": "~> 5.27"}}],
	"backend": {"s3": [{"bucket": "parfocal-tfstate", "key": sprintf("%s.tfstate", [root]), "use_lockfile": true}]},
	"encryption": [{"state": [{"enforced": true}], "plan": [{"enforced": true}]}],
}]}

environment(root) := {"module": {"environment": [{
	"name": root,
	"origin": sprintf("https://%s.parfocal.eu", [root]),
	"dev_mode": false,
}]}}

zone := {"locals": [{"zone_settings": {
	"always_use_https": "on",
	"min_tls_version": "1.2",
	"tls_1_3": "on",
	"ssl": "strict",
}}]}

bucket := {"resource": {"cloudflare_r2_bucket": {"slides": [{"lifecycle": [{"prevent_destroy": true}]}]}}}

good := [
	{"path": "global/versions.tf", "contents": backend("global")},
	{"path": "global/zone.tf", "contents": zone},
	{"path": "dev/versions.tf", "contents": backend("dev")},
	{"path": "dev/main.tf", "contents": {"module": {"environment": [{"name": "dev", "origin": "http://localhost:5173", "dev_mode": true}]}}},
	{"path": "staging/versions.tf", "contents": backend("staging")},
	{"path": "staging/main.tf", "contents": environment("staging")},
	{"path": "prod/versions.tf", "contents": backend("prod")},
	{"path": "prod/main.tf", "contents": environment("prod")},
	{"path": "modules/environment/main.tf", "contents": bucket},
]

with_file(path, contents) := array.concat([file | some file in good; file.path != path], [{"path": path, "contents": contents}])

denied(files, fragment) if {
	some msg in static.deny with input as files
	contains(msg, fragment)
}

test_good_layout_passes if {
	count(static.deny) == 0 with input as good
}

test_paid_resource_type_fails if {
	files := with_file("staging/extra.tf", {"resource": {"cloudflare_workers_kv_namespace": {"cache": [{}]}}})
	denied(files, "not on the free resource list")
}

test_bucket_without_prevent_destroy_fails if {
	files := with_file("modules/environment/main.tf", {"resource": {"cloudflare_r2_bucket": {"slides": [{}]}}})
	denied(files, "must set prevent_destroy")
}

test_shared_state_key_fails if {
	files := with_file("prod/versions.tf", backend("staging"))
	denied(files, "root prod must keep its state")
}

test_unenforced_state_encryption_fails if {
	contents := json.patch(backend("prod"), [{"op": "replace", "path": "/terraform/0/encryption/0/state/0/enforced", "value": false}])
	denied(with_file("prod/versions.tf", contents), "root prod must enforce state encryption")
}

test_missing_plan_encryption_fails if {
	contents := json.patch(backend("staging"), [{"op": "remove", "path": "/terraform/0/encryption/0/plan"}])
	denied(with_file("staging/versions.tf", contents), "root staging must enforce plan encryption")
}

test_unknown_provider_source_fails if {
	contents := json.patch(backend("dev"), [{"op": "replace", "path": "/terraform/0/required_providers/0/cloudflare/source", "value": "someone/cloudflare"}])
	denied(with_file("dev/versions.tf", contents), "allowed sources")
}

test_app_hostname_record_fails if {
	files := with_file("global/dns.tf", {"resource": {"cloudflare_dns_record": {"staging": [{"name": "staging"}]}}})
	denied(files, "Wrangler owns")
}

test_dev_mode_in_prod_fails if {
	contents := {"module": {"environment": [{"name": "prod", "origin": "https://app.parfocal.eu", "dev_mode": true}]}}
	denied(with_file("prod/main.tf", contents), "dev_mode off")
}

test_plain_http_origin_in_staging_fails if {
	contents := {"module": {"environment": [{"name": "staging", "origin": "http://staging.parfocal.eu", "dev_mode": false}]}}
	denied(with_file("staging/main.tf", contents), "https origin")
}

test_wrong_environment_name_fails if {
	denied(with_file("staging/main.tf", environment("prod")), "must name its environment staging")
}

test_weak_tls_zone_setting_fails if {
	contents := json.patch(zone, [{"op": "replace", "path": "/locals/0/zone_settings/ssl", "value": "flexible"}])
	denied(with_file("global/zone.tf", contents), "zone setting ssl")
}
