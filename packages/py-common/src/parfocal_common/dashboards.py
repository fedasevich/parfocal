import json
import sys
from dataclasses import dataclass
from pathlib import Path

from parfocal_common.alerting import SLOS, SliName
from parfocal_common.repository import repository_root

FRAMES_EVENT = "rum.viewer.frames"
SLO_STATUS_EVENT = "slo.status"
EMITTED_EVENTS = frozenset({*(sli.value for sli in SliName), FRAMES_EVENT, SLO_STATUS_EVENT})
DASHBOARD_PATH = repository_root(__file__) / "infra" / "grafana" / "parfocal-overview.json"
LOGS = {"type": "loki", "uid": "${logs}"}


@dataclass(frozen=True)
class Panel:
    title: str
    area: str
    event: str
    expression: str
    unit: str = "short"


def selector(event: str) -> str:
    return f'{{service_name=~".+"}} | event="{event}"'


def rate_of(event: str, extra: str = "") -> str:
    return f"sum(count_over_time({selector(event)}{extra} [5m]))"


def quantile_of(event: str, field: str, share: float) -> str:
    return f"quantile_over_time({share}, {selector(event)} | unwrap {field} [5m]) by (service_name)"


def good_share(event: str) -> str:
    return f"{rate_of(event, ' | ok=`true`')} / {rate_of(event)}"


def slo_good(name: str) -> str:
    return (
        f"max by (slo) ({selector(SLO_STATUS_EVENT)} | slo=`{name}` | unwrap good_permille [15m])"
    )


PANELS: tuple[Panel, ...] = (
    Panel(
        "Requests that did not fail",
        "api",
        SliName.AVAILABILITY.value,
        good_share(SliName.AVAILABILITY.value),
        "percentunit",
    ),
    Panel(
        "Request time p95",
        "api",
        SliName.AVAILABILITY.value,
        quantile_of(SliName.AVAILABILITY.value, "duration_ms", 0.95),
        "ms",
    ),
    Panel(
        "Tiles within 60 ms",
        "tiles",
        SliName.TILE_LATENCY.value,
        good_share(SliName.TILE_LATENCY.value),
        "percentunit",
    ),
    Panel(
        "Slides ready within 10 minutes",
        "ingest",
        SLO_STATUS_EVENT,
        slo_good("ingest-time"),
        "short",
    ),
    Panel(
        "Pre-reads ready within 60 minutes",
        "gpu",
        SLO_STATUS_EVENT,
        slo_good("pre-read-time"),
        "short",
    ),
    Panel(
        "Error budget burn over 1 hour",
        "workers",
        SLO_STATUS_EVENT,
        f"max by (slo) ({selector(SLO_STATUS_EVENT)} | unwrap burn_tenths [15m])",
        "short",
    ),
    Panel(
        "Viewer frame time p95",
        "viewer",
        FRAMES_EVENT,
        quantile_of(FRAMES_EVENT, "p95_ms", 0.5),
        "ms",
    ),
    Panel(
        "Long frames per minute",
        "viewer",
        FRAMES_EVENT,
        f"sum(sum_over_time({selector(FRAMES_EVENT)} | unwrap long_frames [1m]))",
        "short",
    ),
)


def panel_json(index: int, panel: Panel) -> dict[str, object]:
    return {
        "id": index + 1,
        "type": "timeseries",
        "title": panel.title,
        "description": f"{panel.area}: {panel.event}",
        "datasource": LOGS,
        "gridPos": {"h": 8, "w": 12, "x": (index % 2) * 12, "y": (index // 2) * 8},
        "fieldConfig": {"defaults": {"unit": panel.unit}, "overrides": []},
        "targets": [{"refId": "A", "datasource": LOGS, "expr": panel.expression}],
    }


def dashboard() -> dict[str, object]:
    return {
        "uid": "parfocal-overview",
        "title": "Parfocal overview",
        "tags": ["parfocal", "slo"],
        "timezone": "utc",
        "schemaVersion": 39,
        "time": {"from": "now-24h", "to": "now"},
        "templating": {
            "list": [{"name": "logs", "type": "datasource", "query": "loki", "label": "Logs"}]
        },
        "description": "; ".join(f"{slo.name}: {slo.description}" for slo in SLOS),
        "panels": [panel_json(index, panel) for index, panel in enumerate(PANELS)],
    }


def render() -> str:
    return json.dumps(dashboard(), indent=2) + "\n"


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DASHBOARD_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render())


if __name__ == "__main__":
    main()
