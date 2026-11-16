import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import httpx2
from pydantic import BaseModel, ConfigDict, ValidationError

ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$")
MASK = 0xFFFFFFFF

type FlagReason = Literal["killed", "remote_off", "remote", "rule", "split", "default"]
type RemoteArms = Mapping[str, str | Literal[False]]


class FlagRule(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    arm: str
    users: tuple[str, ...] | None = None
    workspaces: tuple[str, ...] | None = None
    roles: tuple[str, ...] | None = None


class FlagDefinition(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    arms: tuple[str, ...]
    default: str
    mode: Literal["default", "split"]
    killed: bool = False
    rules: tuple[FlagRule, ...] = ()


@dataclass(frozen=True)
class FlagContext:
    user_id: str
    workspace_id: str | None = None
    roles: Sequence[str] = ()


@dataclass(frozen=True)
class FlagEvaluation:
    arm: str
    reason: FlagReason


def is_pseudonymous_id(value: str) -> bool:
    return ID_PATTERN.fullmatch(value) is not None


def hash_to_unit(text: str) -> float:
    value = 0x811C9DC5
    data = text.encode("utf-16-le")
    for index in range(0, len(data), 2):
        value ^= data[index] | data[index + 1] << 8
        value = (value * 0x01000193) & MASK
    value ^= value >> 16
    value = (value * 0x85EBCA6B) & MASK
    value ^= value >> 13
    value = (value * 0xC2B2AE35) & MASK
    value ^= value >> 16
    return value / 0x100000000


def assign_arm(flag: str, user_id: str, arms: Sequence[str]) -> str:
    index = int(hash_to_unit(f"{flag}:{user_id}") * len(arms))
    return arms[min(index, len(arms) - 1)]


def _matches(rule: FlagRule, context: FlagContext) -> bool:
    return (
        (rule.users is None or context.user_id in rule.users)
        and (
            rule.workspaces is None
            or (context.workspace_id is not None and context.workspace_id in rule.workspaces)
        )
        and (rule.roles is None or any(role in rule.roles for role in context.roles))
    )


def evaluate_flag(
    definitions: Mapping[str, FlagDefinition],
    flag: str,
    context: FlagContext,
    remote: RemoteArms | None = None,
) -> FlagEvaluation:
    definition = definitions.get(flag)
    if definition is None:
        raise KeyError(f"unknown flag {flag}")
    if not is_pseudonymous_id(context.user_id):
        raise ValueError("flags need a pseudonymous user id")
    if context.workspace_id is not None and not is_pseudonymous_id(context.workspace_id):
        raise ValueError("flags need a pseudonymous workspace id")
    if definition.killed:
        return FlagEvaluation(definition.default, "killed")
    remote_arm = (remote or {}).get(flag)
    if remote_arm is False:
        return FlagEvaluation(definition.default, "remote_off")
    if isinstance(remote_arm, str) and remote_arm in definition.arms:
        return FlagEvaluation(remote_arm, "remote")
    rule = next((rule for rule in definition.rules if _matches(rule, context)), None)
    if rule is not None:
        return FlagEvaluation(rule.arm, "rule")
    if definition.mode == "split":
        return FlagEvaluation(assign_arm(flag, context.user_id, definition.arms), "split")
    return FlagEvaluation(definition.default, "default")


def parse_definitions(raw: Mapping[str, object]) -> dict[str, FlagDefinition]:
    return {key: FlagDefinition.model_validate(value) for key, value in raw.items()}


class RemoteFlag(BaseModel):
    enabled: bool | None = None
    variant: str | None = None


class RemoteAnswer(BaseModel):
    flags: dict[str, RemoteFlag] = {}


def remote_arms_from(body: object, definitions: Mapping[str, FlagDefinition]) -> RemoteArms:
    try:
        flags = RemoteAnswer.model_validate(body).flags
    except ValidationError:
        return {}
    arms: dict[str, str | Literal[False]] = {}
    for key, definition in definitions.items():
        remote = flags.get(key)
        if remote is None:
            continue
        if remote.enabled is False:
            arms[key] = False
        elif remote.variant is not None and remote.variant in definition.arms:
            arms[key] = remote.variant
    return arms


def posthog_flag_request(project_key: str, context: FlagContext) -> dict[str, object]:
    if not is_pseudonymous_id(context.user_id):
        raise ValueError("flags need a pseudonymous user id")
    return {
        "api_key": project_key,
        "distinct_id": context.user_id,
        "groups": {} if context.workspace_id is None else {"workspace": context.workspace_id},
        "person_properties": {"roles": ",".join(sorted(context.roles))},
        "group_properties": {},
    }


@dataclass(frozen=True)
class PostHogRemoteArms:
    http: httpx2.Client
    host: str
    project_key: str
    definitions: Mapping[str, FlagDefinition]

    def __call__(self, context: FlagContext) -> RemoteArms:
        body = posthog_flag_request(self.project_key, context)
        try:
            response = self.http.post(f"{self.host.rstrip('/')}/flags/?v=2", json=body)
            if response.status_code != 200:
                return {}
            return remote_arms_from(response.json(), self.definitions)
        except httpx2.HTTPError, ValueError:
            return {}


@dataclass(frozen=True)
class RuleFlagClient:
    definitions: Mapping[str, FlagDefinition] = field(default_factory=dict[str, FlagDefinition])
    remote: Callable[[FlagContext], RemoteArms] | None = None

    @classmethod
    def from_file(cls, path: Path) -> RuleFlagClient:
        if not path.exists():
            return cls()
        return cls(parse_definitions(json.loads(path.read_text())))

    def evaluate(self, flag: str, context: FlagContext) -> FlagEvaluation:
        if self.definitions.get(flag) is None:
            raise KeyError(f"unknown flag {flag}")
        remote = self.remote(context) if self.remote is not None else None
        return evaluate_flag(self.definitions, flag, context, remote)
