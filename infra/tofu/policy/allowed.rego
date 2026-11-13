package allowed

import rego.v1

free_resource_types := {
	"cloudflare_zone_setting",
	"cloudflare_dns_record",
	"cloudflare_r2_bucket",
	"cloudflare_r2_bucket_cors",
	"cloudflare_r2_bucket_lifecycle",
}

resource_type(type) if type in free_resource_types

resource_type(type) if startswith(type, "zitadel_")

provider_sources := {"cloudflare/cloudflare", "zitadel/zitadel"}

roots := {"global", "dev", "staging", "prod"}

wrangler_hostnames := {"staging", "app", "staging.parfocal.eu", "app.parfocal.eu"}

strict_zone_settings := {
	"always_use_https": "on",
	"min_tls_version": "1.2",
	"tls_1_3": "on",
	"ssl": "strict",
}
