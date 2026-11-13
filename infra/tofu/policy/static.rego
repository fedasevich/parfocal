package static

import data.allowed
import rego.v1

root_of(path) := root if {
	parts := split(path, "/")
	count(parts) >= 2
	root := parts[count(parts) - 2]
	root in allowed.roots
}

deny contains msg if {
	some file in input
	some type, _ in file.contents.resource
	not allowed.resource_type(type)
	msg := sprintf("%s declares %s, which is not on the free resource list in policy/allowed.rego", [file.path, type])
}

deny contains msg if {
	some file in input
	some name, blocks in file.contents.resource.cloudflare_r2_bucket
	some block in blocks
	not keeps_bucket(block)
	msg := sprintf("%s bucket %s must set prevent_destroy", [file.path, name])
}

keeps_bucket(block) if {
	some rule in block.lifecycle
	rule.prevent_destroy == true
}

deny contains msg if {
	some file in input
	some block in file.contents.terraform
	some name, provider in block.required_providers[_]
	not pinned(provider)
	msg := sprintf("%s provider %s must come from the allowed sources with a version constraint", [file.path, name])
}

pinned(provider) if {
	provider.source in allowed.provider_sources
	provider.version != ""
}

deny contains msg if {
	some root in allowed.roots
	not has_backend(root)
	msg := sprintf("root %s must keep its state in parfocal-tfstate under %s.tfstate with a lock file", [root, root])
}

has_backend(root) if {
	some file in input
	root_of(file.path) == root
	some block in file.contents.terraform
	some backend in block.backend.s3
	backend.bucket == "parfocal-tfstate"
	backend.key == sprintf("%s.tfstate", [root])
	backend.use_lockfile == true
}

deny contains msg if {
	some root in allowed.roots
	some target in {"state", "plan"}
	not encrypts(root, target)
	msg := sprintf("root %s must enforce %s encryption", [root, target])
}

encrypts(root, target) if {
	some file in input
	root_of(file.path) == root
	some block in file.contents.terraform
	some encryption in block.encryption
	some rule in encryption[target]
	rule.enforced == true
}

deny contains msg if {
	some file in input
	some name, blocks in file.contents.resource.cloudflare_dns_record
	some block in blocks
	block.name in allowed.wrangler_hostnames
	msg := sprintf("%s record %s is an app hostname, which Wrangler owns as a custom domain", [file.path, name])
}

deny contains msg if {
	some file in input
	root := root_of(file.path)
	some call in file.contents.module.environment
	call.name != root
	msg := sprintf("%s must name its environment %s", [file.path, root])
}

deny contains msg if {
	some file in input
	some call in file.contents.module.environment
	call.name != "dev"
	call.dev_mode != false
	msg := sprintf("%s must keep dev_mode off outside dev", [file.path])
}

deny contains msg if {
	some file in input
	some call in file.contents.module.environment
	call.name != "dev"
	not startswith(call.origin, "https://")
	msg := sprintf("%s must use an https origin outside dev", [file.path])
}

deny contains msg if {
	some setting, value in allowed.strict_zone_settings
	not zone_setting(setting, value)
	msg := sprintf("the global root must set zone setting %s to %s", [setting, value])
}

zone_setting(setting, value) if {
	some file in input
	root_of(file.path) == "global"
	some block in file.contents.locals
	block.zone_settings[setting] == value
}
