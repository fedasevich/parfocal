import json
import re

from parfocal_common.alerting import SLOS
from parfocal_common.dashboards import DASHBOARD_PATH, EMITTED_EVENTS, PANELS, render
from parfocal_common.scrubbing import ALLOWED_FIELDS

AREAS = {"api", "tiles", "ingest", "gpu", "workers", "viewer"}


def test_the_committed_dashboard_is_the_generated_one() -> None:
    assert DASHBOARD_PATH.read_text() == render(), (
        "infra/grafana/parfocal-overview.json is stale, run: "
        "uv run python -m parfocal_common.dashboards"
    )


def test_every_panel_reads_an_event_the_code_emits() -> None:
    for panel in PANELS:
        assert panel.event in EMITTED_EVENTS
        assert f'event="{panel.event}"' in panel.expression


def test_every_field_a_panel_filters_or_unwraps_is_allow_listed() -> None:
    for panel in PANELS:
        fields = re.findall(r"\| (\w+)=`", panel.expression) + re.findall(
            r"unwrap (\w+)", panel.expression
        )
        assert set(fields) <= ALLOWED_FIELDS, panel.title


def test_the_dashboard_covers_each_area_and_names_every_slo() -> None:
    assert {panel.area for panel in PANELS} == AREAS
    parsed = json.loads(render())
    assert all(slo.name in parsed["description"] for slo in SLOS)
