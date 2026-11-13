package plan

import data.allowed
import rego.v1

deny contains msg if {
	some change in input.resource_changes
	"delete" in change.change.actions
	msg := sprintf("%s would be deleted or replaced, which needs the owner's yes in chat", [change.address])
}

deny contains msg if {
	some change in input.resource_changes
	change.mode == "managed"
	not allowed.resource_type(change.type)
	msg := sprintf("%s has type %s, which is not on the free resource list in policy/allowed.rego", [change.address, change.type])
}
