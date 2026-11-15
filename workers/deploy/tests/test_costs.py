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
    ModalCost,
    Service,
    Status,
    budget_lines,
    collect,
    failing,
    latest_bucket_sizes,
    modal_spend,
    r2_spend,
    render,
)
from parfocal_deploy.environments import ENVIRONMENTS

GB = 10**9


def test_budgets_fit_inside_the_monthly_cap():
    total = sum(sum(services.values(), Decimal(0)) for services in BUDGETS.values())
    assert total <= MONTHLY_CAP_USD


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
            ModalCost("staging", Decimal("0.05")),
        ]
    )
    assert spend == {
        "production": Decimal(2),
        "drill": Decimal("0.10"),
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

    def read_modal(start: date) -> list[ModalCost]:
        seen.append(start)
        return [ModalCost("main", Decimal(25))]

    lines = collect(date(2026, 11, 15), read_modal, lambda: {"parfocal-dev": 26 * GB})
    assert seen == [date(2026, 11, 1)]
    over = failing(lines)
    assert [(line.environment, line.service) for line in over] == [("production", Service.MODAL)]


def test_render_shows_each_line_and_the_cap():
    lines = budget_lines({Service.MODAL: {"production": Decimal("4.567")}, Service.R2: {}})
    text = render(lines, date(2026, 11, 15))
    assert "# Cost dashboard for 2026-11" in text
    assert "| production | Modal | $4.57 | $20.00 | ok |" in text
    assert "| all | all | $4.57 | $28.50 | ok against the $30.00 cap |" in text


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
    monkeypatch.setattr(costs, "read_modal_live", lambda _: [ModalCost("main", Decimal(21))])
    monkeypatch.setattr(costs, "read_r2_live", lambda *_: {"parfocal-dev": GB})
    out = tmp_path / "costs.md"
    assert costs.main(["--out", str(out)]) == 1
    assert "| production | Modal | $21.00 | $20.00 | over |" in out.read_text()
    assert capsys.readouterr().out == out.read_text()


def test_main_passes_inside_budget(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(costs, "read_modal_live", lambda _: [])
    monkeypatch.setattr(costs, "read_r2_live", lambda *_: {})
    assert costs.main([]) == 0
