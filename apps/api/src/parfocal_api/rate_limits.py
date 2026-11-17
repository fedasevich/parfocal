import random
import time
from collections.abc import Callable
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
FLUSH_PARTS = 20


@dataclass(frozen=True)
class RateLimits:
    person_per_minute: int
    tenant_per_minute: int
    report_link_per_minute: int = 60


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
    return await counted_wait(connection, limits_for(principal, limits))


async def report_link_wait(
    connection: AsyncConnection, link_id: object, limits: RateLimits
) -> int | None:
    return await counted_wait(connection, {f"report-link:{link_id}": limits.report_link_per_minute})


@dataclass
class LocalCount:
    minute: int
    known: int = 0
    pending: int = 0


def flush_chunk(limit: int) -> int:
    return max(1, limit // FLUSH_PARTS)


class BatchedCounts:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self.counts: dict[str, LocalCount] = {}

    def claim(self, allowed: dict[str, int]) -> dict[str, int] | None:
        minute = int(self.clock() // WINDOW.total_seconds())
        due = False
        for key, limit in allowed.items():
            count = self.counts.get(key)
            if count is None or count.minute != minute:
                count = self.counts[key] = LocalCount(minute)
                due = True
            count.pending += 1
            if count.pending >= flush_chunk(limit) or (count.known + count.pending) * 2 > limit:
                due = True
        if not due:
            return None
        claimed = {key: self.counts[key].pending for key in allowed}
        for key in allowed:
            self.counts[key].pending = 0
        self.forget_before(minute)
        return claimed

    def learn(self, totals: dict[str, int]) -> None:
        for key, total in totals.items():
            count = self.counts.get(key)
            if count is not None:
                count.known = max(count.known, total)

    def forget_before(self, minute: int) -> None:
        stale = [key for key, count in self.counts.items() if count.minute < minute]
        for key in stale:
            del self.counts[key]


async def counted_wait(
    connection: AsyncConnection,
    allowed: dict[str, int],
    claimed: dict[str, int] | None = None,
    counts: BatchedCounts | None = None,
) -> int | None:
    if not allowed:
        return None
    window = func.date_trunc("minute", func.now())
    statement = insert(rate_counters).values(
        [
            {"key": key, "window_start": window, "count": 1 if claimed is None else claimed[key]}
            for key in allowed
        ]
    )
    counted = await connection.execute(
        statement.on_conflict_do_update(
            index_elements=[rate_counters.c.key, rate_counters.c.window_start],
            set_={"count": rate_counters.c.count + statement.excluded.count},
        ).returning(
            rate_counters.c.key,
            rate_counters.c.count.label("hits"),
            func.ceil(func.extract("epoch", window + WINDOW - func.clock_timestamp())).label(
                "left"
            ),
        )
    )
    rows = counted.all()
    if counts is not None:
        counts.learn({row.key: row.hits for row in rows})
    over = [row for row in rows if row.hits > allowed[row.key]]
    if random.random() < SWEEP_CHANCE:
        await connection.execute(
            delete(rate_counters).where(
                rate_counters.c.window_start < literal_column("now()") - KEPT
            )
        )
    if not over:
        return None
    return max(1, int(over[0].left))
