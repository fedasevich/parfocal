import io
import json
import urllib.request
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from parfocal_deploy import costs
from parfocal_deploy.costs import (
    BUDGETS,
    MONTHLY_CAP_USD,
    UNBUDGETED,
    Line,
    ModalBill,
    ModalCost,
    ModalUsage,
    Report,
    Service,
    Status,
    budget_lines,
    collect,
    covered_shares,
    credit_used,
    failing,
    latest_bucket_sizes,
    modal_spend,
    r2_spend,
    render,
)
from parfocal_deploy.environments import ENVIRONMENTS

GB = 10**9
RECORDED = Path(__file__).parent / "fixtures" / "modal-usage-2026-11-25.json"


def bill(
    credits: Decimal = Decimal(0),
    egress: Decimal = Decimal(0),
    allowance: Decimal = Decimal(0),
    billed: Decimal = Decimal(0),
) -> ModalBill:
    return ModalBill(
        metered_cost=-credits + egress + billed,
        metered_cost_breakdown={"Network Egress": egress},
        adjustments={
            "Credits": credits,
            "Network Egress Allowance": allowance,
            "Plan Cost": Decimal(0),
        },
        billed_cost=billed,
    )


def usage(items: list[ModalCost]) -> ModalUsage:
    spend = sum((item.cost for item in items), Decimal(0))
    return ModalUsage(bill(credits=-spend), items)


def recorded() -> ModalUsage:
    answer = json.loads(RECORDED.read_text())
    summary = answer["summary"]
    return ModalUsage(
        ModalBill(
            Decimal(summary["metered_cost"]),
            {key: Decimal(value) for key, value in summary["metered_cost_breakdown"].items()},
            {key: Decimal(value) for key, value in summary["adjustments"].items()},
            Decimal(summary["billed_cost"]),
        ),
        [
            ModalCost(
                row["environment_name"],
                Decimal(row["cost"]),
                {key: Decimal(value) for key, value in row["cost_by_resource"].items()},
            )
            for row in answer["report"]
        ],
    )


def test_the_recorded_answer_reads_as_modals_billing_page():
    answer = recorded()
    assert credit_used(answer.bill) == Decimal("11.08")
    report = collect(date(2026, 11, 25), lambda _: answer, dict)
    text = render(report, date(2026, 11, 25))
    assert "| all | Modal | $11.08 | $30.00 | ok against the $30.00 Modal credit |" in text
    assert "| production | Modal | $10.79 | $23.50 | ok |" in text
    assert "| dev | Modal | $0.26 | $3.00 | ok |" in text


def test_summing_the_report_cost_counts_egress_the_allowance_covers():
    answer = recorded()
    assert sum((item.cost for item in answer.items), Decimal(0)).quantize(
        Decimal("0.01")
    ) == Decimal("30.24")
    assert covered_shares(answer.bill) == {"Network Egress": Decimal(1)}


def test_credit_used_counts_spend_past_the_credit():
    assert credit_used(bill(credits=Decimal(-30), billed=Decimal("2.5"))) == Decimal("32.5")


def test_credit_used_refuses_a_summary_without_credits():
    answer = ModalBill(Decimal(5), {}, {"Plan Cost": Decimal(0)}, Decimal(0))
    with pytest.raises(RuntimeError, match="no 'Credits' adjustment"):
        credit_used(answer)


def test_a_partial_egress_allowance_takes_off_its_share():
    covered = covered_shares(bill(egress=Decimal(20), allowance=Decimal(-5)))
    assert covered == {"Network Egress": Decimal("0.25")}
    item = ModalCost("main", Decimal(30), {"Network Egress": Decimal(20), "CPU": Decimal(10)})
    assert modal_spend([item], covered) == {"production": Decimal(25)}


def test_egress_without_an_allowance_counts_in_full():
    assert covered_shares(bill(egress=Decimal(4))) == {"Network Egress": Decimal(0)}
    assert covered_shares(bill()) == {}


def test_modal_budgets_use_the_whole_monthly_credit():
    total = sum(services.get(Service.MODAL, Decimal(0)) for services in BUDGETS.values())
    assert total == MONTHLY_CAP_USD


def test_every_cloud_environment_has_a_budget():
    production = ENVIRONMENTS["production"]
    assert production.modal_environment == "main"
    assert modal_spend([ModalCost(production.modal_environment, Decimal(1))]) == {
        "production": Decimal(1)
    }
    assert set(r2_spend({production.slide_bucket: 20 * GB})) == {"production"}


def test_modal_spend_groups_by_environment_and_flags_unknown_ones():
    spend = modal_spend(
        [
            ModalCost("main", Decimal("1.25")),
            ModalCost("main", Decimal("0.75")),
            ModalCost("drill-2026-11-15", Decimal("0.10")),
            ModalCost("pr-12", Decimal("0.20")),
            ModalCost("staging", Decimal("0.05")),
        ]
    )
    assert spend == {
        "production": Decimal(2),
        "drill": Decimal("0.10"),
        "preview": Decimal("0.20"),
        UNBUDGETED: Decimal("0.05"),
    }


def test_r2_spend_stays_free_under_ten_gigabytes():
    assert r2_spend({"parfocal-dev": 6 * GB, "parfocal-prod": 3 * GB}) == {"production": Decimal(0)}


def test_r2_spend_shares_the_account_cost_past_the_free_tier_by_size():
    spend = r2_spend({"parfocal-dev": 30 * GB, "parfocal-drill-x": 10 * GB})
    assert spend["production"] == Decimal("0.3375")
    assert spend["drill"] == Decimal("0.1125")


def test_r2_spend_of_an_empty_account_is_nothing():
    assert r2_spend({}) == {}


def test_line_status_warns_at_eighty_percent_and_fails_over_budget():
    assert Line("dev", Service.MODAL, Decimal("2.39"), Decimal(3)).status is Status.OK
    assert Line("dev", Service.MODAL, Decimal("2.40"), Decimal(3)).status is Status.WARN
    assert Line("dev", Service.MODAL, Decimal("3.01"), Decimal(3)).status is Status.OVER
    assert Line(UNBUDGETED, Service.MODAL, Decimal("0.01"), Decimal(0)).status is Status.OVER
    assert Line("dev", Service.R2, Decimal(0), Decimal(0)).status is Status.OK


def test_budget_lines_list_every_budget_even_without_spend():
    lines = budget_lines({Service.MODAL: {}, Service.R2: {}})
    assert {(line.environment, line.service) for line in lines} == {
        (env, service) for env, services in BUDGETS.items() for service in services
    }
    assert failing(lines) == []


def test_collect_reads_modal_from_the_first_of_the_month():
    seen: list[date] = []

    def read_modal(start: date) -> ModalUsage:
        seen.append(start)
        return usage([ModalCost("main", Decimal(25))])

    report = collect(date(2026, 11, 15), read_modal, lambda: {"parfocal-dev": 26 * GB})
    assert seen == [date(2026, 11, 1)]
    over = failing(report.lines)
    assert [(line.environment, line.service) for line in over] == [("production", Service.MODAL)]


def test_render_shows_each_line_and_the_modal_credit():
    lines = budget_lines({Service.MODAL: {"production": Decimal("4.567")}, Service.R2: {}})
    text = render(Report(lines, Decimal("4.567")), date(2026, 11, 15))
    assert "# Cost dashboard for 2026-11" in text
    assert "| production | Modal | $4.57 | $23.50 | ok |" in text
    assert "| all | Modal | $4.57 | $30.00 | ok against the $30.00 Modal credit |" in text


def test_latest_bucket_sizes_keep_the_newest_sample_per_bucket():
    groups = [
        {
            "dimensions": {"bucketName": "parfocal-dev", "datetime": "2026-11-14T00:00:00Z"},
            "max": {"payloadSize": 5, "metadataSize": 1},
        },
        {
            "dimensions": {"bucketName": "parfocal-dev", "datetime": "2026-11-15T00:00:00Z"},
            "max": {"payloadSize": 9, "metadataSize": 1},
        },
        {
            "dimensions": {"bucketName": "parfocal-prod", "datetime": "2026-11-13T00:00:00Z"},
            "max": {"payloadSize": 0, "metadataSize": 0},
        },
    ]
    assert latest_bucket_sizes(groups) == {"parfocal-dev": 10, "parfocal-prod": 0}


class FakeResponse(io.BytesIO):
    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def analytics(body: dict[str, Any]) -> Callable[..., FakeResponse]:
    def urlopen(request: urllib.request.Request, timeout: int) -> FakeResponse:
        assert request.full_url == costs.GRAPHQL_URL
        assert request.get_header("Authorization") == "Bearer token"
        assert timeout == costs.TIMEOUT_SECONDS
        return FakeResponse(json.dumps(body).encode())

    return urlopen


ENVIRON = {"R2_ACCOUNT_ID": "account", "CLOUDFLARE_API_TOKEN": "token"}
NOW = datetime(2026, 11, 15, tzinfo=UTC)


def test_read_r2_live_returns_bucket_sizes(monkeypatch: pytest.MonkeyPatch):
    group = {
        "dimensions": {"bucketName": "parfocal-dev", "datetime": "2026-11-15T00:00:00Z"},
        "max": {"payloadSize": 7, "metadataSize": 0},
    }
    body = {"data": {"viewer": {"accounts": [{"r2StorageAdaptiveGroups": [group]}]}}}
    monkeypatch.setattr(urllib.request, "urlopen", analytics(body))
    assert costs.read_r2_live(ENVIRON, NOW) == {"parfocal-dev": 7}


def test_read_r2_live_raises_on_analytics_errors(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(urllib.request, "urlopen", analytics({"errors": [{"message": "no"}]}))
    with pytest.raises(RuntimeError, match="refused the query"):
        costs.read_r2_live(ENVIRON, NOW)


def test_main_writes_the_dashboard_and_fails_over_budget(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(costs, "read_modal_live", lambda _: usage([ModalCost("main", Decimal(24))]))
    monkeypatch.setattr(costs, "read_r2_live", lambda *_: {"parfocal-dev": GB})
    out = tmp_path / "costs.md"
    assert costs.main(["--out", str(out)]) == 1
    assert "| production | Modal | $24.00 | $23.50 | over |" in out.read_text()
    assert capsys.readouterr().out == out.read_text()


def test_main_passes_inside_budget(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(costs, "read_modal_live", lambda _: usage([]))
    monkeypatch.setattr(costs, "read_r2_live", lambda *_: {})
    assert costs.main([]) == 0


def test_a_bucket_in_a_jurisdiction_counts_for_its_environment():
    assert set(r2_spend({"eu_parfocal-dev-eu": 20 * GB})) == {"production"}


def test_read_modal_live_reads_whole_days_daily_and_today_hourly(monkeypatch: pytest.MonkeyPatch):
    import modal
    from modal.types import BillingReportItem, WorkspaceBillingSummary

    calls: list[tuple[datetime, datetime | None, str]] = []
    month = datetime(2026, 11, 1, tzinfo=UTC)
    today = datetime(2026, 11, 25, tzinfo=UTC)

    def row(start: datetime) -> BillingReportItem:
        return BillingReportItem(
            "ap-1", "parfocal-api", "main", start, Decimal(1), {"CPU": Decimal(1)}, {}
        )

    class Billing:
        def summary(self, cycle: datetime) -> WorkspaceBillingSummary:
            assert cycle == month
            return WorkspaceBillingSummary(
                month, month, Decimal(2), {}, {"Credits": Decimal(-2)}, Decimal(0)
            )

        def report(self, *, start: datetime, end: datetime | None = None, resolution: str):
            calls.append((start, end, resolution))
            return [row(start)]

    class Workspace:
        billing = Billing()

    monkeypatch.setattr(modal.Workspace, "from_context", staticmethod(lambda: Workspace()))
    answer = costs.read_modal_live(date(2026, 11, 25), datetime(2026, 11, 25, 19, 56, tzinfo=UTC))
    assert calls == [(month, today, "d"), (today, None, "h")]
    assert credit_used(answer.bill) == Decimal(2)
    assert [item.cost_by_resource for item in answer.items] == [{"CPU": Decimal(1)}] * 2

    calls.clear()
    costs.read_modal_live(date(2026, 11, 1), datetime(2026, 11, 1, 3, tzinfo=UTC))
    assert calls == [(month, None, "h")]
