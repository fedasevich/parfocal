import argparse
import json
import os
import sys
import urllib.request
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from pathlib import Path

MONTHLY_CAP_USD = Decimal(30)
WARN_SHARE = Decimal("0.8")
R2_FREE_BYTES = 10 * 10**9
R2_STANDARD_USD_PER_GB_MONTH = Decimal("0.015")
GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
TIMEOUT_SECONDS = 60
CENT = Decimal("0.01")
UNBUDGETED = "unbudgeted"


class Service(StrEnum):
    MODAL = "Modal"
    R2 = "Cloudflare R2"


BUDGETS: dict[str, dict[Service, Decimal]] = {
    "production": {Service.MODAL: Decimal(20), Service.R2: Decimal(3)},
    "dev": {Service.MODAL: Decimal(3)},
    "drill": {Service.MODAL: Decimal(2), Service.R2: Decimal("0.5")},
}

MODAL_ENVIRONMENTS = {"main": "production", "dev": "dev"}
BUCKETS = {
    "parfocal-dev": "production",
    "parfocal-prod": "production",
    "parfocal-tfstate": "production",
}
DRILL_PREFIX = "drill"


class Status(StrEnum):
    OK = "ok"
    WARN = "warn"
    OVER = "over"


@dataclass(frozen=True)
class ModalCost:
    environment_name: str
    cost: Decimal


@dataclass(frozen=True)
class Line:
    environment: str
    service: Service
    spend: Decimal
    budget: Decimal

    @property
    def status(self) -> Status:
        if self.spend > self.budget:
            return Status.OVER
        if self.budget > 0 and self.spend >= self.budget * WARN_SHARE:
            return Status.WARN
        return Status.OK


ModalReader = Callable[[date], list[ModalCost]]
R2Reader = Callable[[], dict[str, int]]


def environment_of_modal(name: str) -> str:
    if name.startswith(DRILL_PREFIX):
        return "drill"
    return MODAL_ENVIRONMENTS.get(name, UNBUDGETED)


def environment_of_bucket(name: str) -> str:
    if name.startswith(f"parfocal-{DRILL_PREFIX}"):
        return "drill"
    return BUCKETS.get(name, UNBUDGETED)


def modal_spend(items: Iterable[ModalCost]) -> dict[str, Decimal]:
    spend: dict[str, Decimal] = defaultdict(Decimal)
    for item in items:
        spend[environment_of_modal(item.environment_name)] += item.cost
    return dict(spend)


def r2_spend(bytes_by_bucket: Mapping[str, int]) -> dict[str, Decimal]:
    total = sum(bytes_by_bucket.values())
    billable_gb = Decimal(max(0, total - R2_FREE_BYTES)) / Decimal(10**9)
    account_cost = billable_gb * R2_STANDARD_USD_PER_GB_MONTH
    spend: dict[str, Decimal] = defaultdict(Decimal)
    for bucket, size in bytes_by_bucket.items():
        share = Decimal(size) / Decimal(total) if total else Decimal(0)
        spend[environment_of_bucket(bucket)] += account_cost * share
    return dict(spend)


def budget_lines(spend: Mapping[Service, Mapping[str, Decimal]]) -> list[Line]:
    lines: list[Line] = []
    keys = {(env, service) for env, services in BUDGETS.items() for service in services}
    keys |= {(env, service) for service, by_env in spend.items() for env in by_env}
    for env, service in sorted(keys):
        budget = BUDGETS.get(env, {}).get(service, Decimal(0))
        amount = spend.get(service, {}).get(env, Decimal(0))
        lines.append(Line(env, service, amount, budget))
    return lines


def collect(today: date, read_modal: ModalReader, read_r2: R2Reader) -> list[Line]:
    month_start = today.replace(day=1)
    return budget_lines(
        {
            Service.MODAL: modal_spend(read_modal(month_start)),
            Service.R2: r2_spend(read_r2()),
        }
    )


def usd(amount: Decimal) -> str:
    return f"${amount.quantize(CENT, rounding=ROUND_HALF_UP)}"


def table_row(*cells: str) -> str:
    return f"| {' | '.join(cells)} |"


def render(lines: list[Line], today: date) -> str:
    total_spend = sum((line.spend for line in lines), Decimal(0))
    total_budget = sum((line.budget for line in lines), Decimal(0))
    rows = [
        table_row(line.environment, line.service, usd(line.spend), usd(line.budget), line.status)
        for line in lines
    ]
    cap_status = "over" if total_spend > MONTHLY_CAP_USD else "ok"
    return "\n".join(
        [
            f"# Cost dashboard for {today:%Y-%m}",
            "",
            f"Read on {today.isoformat()}. Modal is spend so far this month. "
            "R2 is the month's storage cost at today's size, priced as Standard storage "
            "past the account's free 10 GB.",
            "",
            "| Environment | Service | Spend | Budget | Status |",
            "|---|---|---|---|---|",
            *rows,
            table_row(
                "all",
                "all",
                usd(total_spend),
                usd(total_budget),
                f"{cap_status} against the {usd(MONTHLY_CAP_USD)} cap",
            ),
            "",
        ]
    )


def failing(lines: list[Line]) -> list[Line]:
    return [line for line in lines if line.status is Status.OVER]


def read_modal_live(start: date) -> list[ModalCost]:
    from modal.billing import workspace_billing_report

    items = workspace_billing_report(start=datetime(start.year, start.month, start.day, tzinfo=UTC))
    return [ModalCost(item["environment_name"], Decimal(item["cost"])) for item in items]


R2_QUERY = """
query ($account: String!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      r2StorageAdaptiveGroups(
        limit: 1000
        filter: {datetime_geq: $start, datetime_leq: $end}
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize }
        dimensions { bucketName datetime }
      }
    }
  }
}
"""


def latest_bucket_sizes(groups: Iterable[Mapping[str, Mapping[str, object]]]) -> dict[str, int]:
    latest: dict[str, tuple[str, int]] = {}
    for group in groups:
        bucket = str(group["dimensions"]["bucketName"])
        stamp = str(group["dimensions"]["datetime"])
        size = int(str(group["max"]["payloadSize"])) + int(str(group["max"]["metadataSize"]))
        if bucket not in latest or stamp > latest[bucket][0]:
            latest[bucket] = (stamp, size)
    return {bucket: size for bucket, (_, size) in latest.items()}


def read_r2_live(environ: Mapping[str, str], now: datetime) -> dict[str, int]:
    variables = {
        "account": environ["R2_ACCOUNT_ID"],
        "start": (now - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    request = urllib.request.Request(
        GRAPHQL_URL,
        data=json.dumps({"query": R2_QUERY, "variables": variables}).encode(),
        headers={
            "Authorization": f"Bearer {environ['CLOUDFLARE_API_TOKEN']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        body = json.load(response)
    if body.get("errors"):
        raise RuntimeError(f"Cloudflare analytics refused the query: {body['errors']}")
    accounts = body["data"]["viewer"]["accounts"]
    return latest_bucket_sizes(accounts[0]["r2StorageAdaptiveGroups"] if accounts else [])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.costs")
    parser.add_argument("--out", type=Path, help="write the dashboard here as well as to stdout")
    args = parser.parse_args(argv)
    now = datetime.now(UTC)
    lines = collect(now.date(), read_modal_live, lambda: read_r2_live(os.environ, now))
    dashboard = render(lines, now.date())
    sys.stdout.write(dashboard)
    if args.out:
        args.out.write_text(dashboard)
    return 1 if failing(lines) else 0


if __name__ == "__main__":
    raise SystemExit(main())
