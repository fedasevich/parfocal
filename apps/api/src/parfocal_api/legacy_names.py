from parfocal_api.audit import AuditAction

OLD_REVIEW_TABLE = "verdicts"

OLD_AUDIT_ACTIONS: dict[str, str] = {
    "review.verdict-set": AuditAction.REVIEW_OBJECT_DECIDED,
    "review.verdict-cleared": AuditAction.REVIEW_OBJECT_DECISION_CLEARED,
}


def current_action(stored: str) -> str:
    return OLD_AUDIT_ACTIONS.get(stored, stored)


def stored_actions(actions: list[str]) -> list[str]:
    old = [name for name, current in OLD_AUDIT_ACTIONS.items() if current in actions]
    return [*actions, *old]


def stored_under_prefix(prefix: str) -> list[str]:
    return [name for name, current in OLD_AUDIT_ACTIONS.items() if current.startswith(prefix)]
