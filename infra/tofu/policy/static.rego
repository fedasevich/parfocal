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

deny contains msg if {
	not strict_transport_security
	msg := sprintf("the global root must turn on zone HSTS for subdomains with a max age of at least %d seconds", [allowed.minimum_hsts_seconds])
}

strict_transport_security if {
	some file in input
	root_of(file.path) == "global"
	some block in file.contents.locals
	hsts := block.strict_transport_security
	hsts.enabled == true
	hsts.include_subdomains == true
	hsts.max_age >= allowed.minimum_hsts_seconds
}

lifecycle_rules contains [file.path, rule] if {
	some file in input
	some _, blocks in file.contents.resource.cloudflare_r2_bucket_lifecycle
	some block in blocks
	some rule in block.rules
}

deny contains msg if {
	some [path, rule] in lifecycle_rules
	rule.delete_objects_transition
	msg := sprintf("%s lifecycle rule %s deletes objects, which no rule may do to slides", [path, rule.id])
}

deny contains msg if {
	some [path, rule] in lifecycle_rules
	rule.conditions.prefix != allowed.lifecycle_prefix
	msg := sprintf("%s lifecycle rule %s must keep the prefix %s, so fixtures and other keys stay out", [path, rule.id, allowed.lifecycle_prefix])
}

deny contains msg if {
	some [path, rule] in lifecycle_rules
	some transition in rule.storage_class_transitions
	not transition.storage_class in allowed.storage_classes
	msg := sprintf("%s lifecycle rule %s moves objects to an unknown storage class", [path, rule.id])
}

deny contains msg if {
	some [path, rule] in lifecycle_rules
	some transition in rule.storage_class_transitions
	is_number(transition.condition.max_age)
	transition.condition.max_age < allowed.minimum_tier_age_seconds
	msg := sprintf("%s lifecycle rule %s tiers objects younger than the 30 day minimum storage duration", [path, rule.id])
}

deny contains msg if {
	not tiers_old_objects
	msg := "the environment module must keep a lifecycle rule that moves old tenant objects to Infrequent Access"
}

deny contains msg if {
	not locks_tenant_objects
	msg := "the environment module must keep an enabled R2 bucket lock on the prefix t/, the recovery rule for deleted or overwritten slides"
}

locks_tenant_objects if {
	some file in input
	startswith(file.path, "modules/environment/")
	some _, blocks in file.contents.resource.cloudflare_r2_bucket_lock
	some block in blocks
	some rule in block.rules
	rule.enabled == true
	rule.prefix == allowed.lifecycle_prefix
}

tiers_old_objects if {
	some [path, rule] in lifecycle_rules
	startswith(path, "modules/environment/")
	count(rule.storage_class_transitions) > 0
}
