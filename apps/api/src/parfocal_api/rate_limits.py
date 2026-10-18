import random
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, func, literal_column
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.principals import (
    MemberPrincipal,
    PlatformOperator,
    Principal,
    ServicePrincipal,
    SignedInUser,
)
from parfocal_api.tables import rate_counters

WINDOW = timedelta(minutes=1)
KEPT = timedelta(minutes=5)
SWEEP_CHANCE = 0.01


@dataclass(frozen=True)
class RateLimits:
    person_per_minute: int
    tenant_per_minute: int


def limits_for(principal: Principal, limits: RateLimits) -> dict[str, int]:
    match principal:
        case MemberPrincipal(user_id=user_id, tenant_id=tenant_id):
            return {
                f"user:{user_id}": limits.person_per_minute,
                f"tenant:{tenant_id}": limits.tenant_per_minute,
            }
        case ServicePrincipal(account_id=account_id, tenant_id=tenant_id):
            return {
                f"service:{account_id}": limits.person_per_minute,
                f"tenant:{tenant_id}": limits.tenant_per_minute,
            }
        case SignedInUser(user_id=user_id):
            return {f"user:{user_id}": limits.person_per_minute}
        case PlatformOperator():
            return {}


async def seconds_to_wait(
    connection: AsyncConnection, principal: Principal, limits: RateLimits
) -> int | None:
    allowed = limits_for(principal, limits)
    if not allowed:
        return None
    window = func.date_trunc("minute", func.now())
    statement = insert(rate_counters).values(
        [{"key": key, "window_start": window, "count": 1} for key in allowed]
    )
    counted = await connection.execute(
        statement.on_conflict_do_update(
            index_elements=[rate_counters.c.key, rate_counters.c.window_start],
            set_={"count": rate_counters.c.count + 1},
        ).returning(
            rate_counters.c.key,
            rate_counters.c.count.label("hits"),
            func.ceil(func.extract("epoch", window + WINDOW - func.clock_timestamp())).label(
                "left"
            ),
        )
    )
    over = [row for row in counted if row.hits > allowed[row.key]]
    if random.random() < SWEEP_CHANCE:
        await connection.execute(
            delete(rate_counters).where(
                rate_counters.c.window_start < literal_column("now()") - KEPT
            )
        )
    if not over:
        return None
    return max(1, int(over[0].left))
