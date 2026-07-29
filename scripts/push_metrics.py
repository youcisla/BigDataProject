"""Push Prometheus metrics to Pushgateway.

Used by Bronze/Silver/Gold layer scripts to emit per-layer metrics
that Prometheus scrapes from the Pushgateway.

Usage:
    from scripts.push_metrics import PushgatewayClient

    pg = PushgatewayClient("pushgateway", 9091, job="bronze")
    pg.inc("bronze_records_total", labels={"source": "reddit"}, value=42)
    pg.observe("bronze_write_duration_seconds", labels={"source": "reddit"}, value=12.5)
    pg.push()
"""

from __future__ import annotations

import logging
import os
from typing import Iterable

logger = logging.getLogger(__name__)


class PushgatewayClient:
    def __init__(self, host: str | None = None, port: int | None = None, job: str = "bigdata"):
        self.host = host or os.environ.get("PUSHGATEWAY_HOST", "pushgateway")
        self.port = port or int(os.environ.get("PUSHGATEWAY_PORT", "9091"))
        self.job = job
        self._metrics: list[tuple[str, dict, float]] = []

    def _base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def inc(self, name: str, labels: dict | None = None, value: float = 1.0) -> None:
        self._metrics.append((name, labels or {}, value))

    def observe(self, name: str, labels: dict | None = None, value: float = 0.0) -> None:
        self._metrics.append((name, labels or {}, value))

    def push(self) -> bool:
        if not self._metrics:
            return True
        body_lines = []
        for name, labels, value in self._metrics:
            label_str = ",".join(f'{k}="{v}"' for k, v in labels.items())
            if label_str:
                body_lines.append(f"{name}{{{label_str}}} {value}")
            else:
                body_lines.append(f"{name} {value}")
        body = "\n".join(body_lines) + "\n"

        try:
            import requests

            url = f"{self._base_url()}/metrics/job/{self.job}"
            response = requests.put(url, data=body, timeout=5)
            response.raise_for_status()
            self._metrics.clear()
            logger.info("Pushed %d metrics to %s", len(body_lines), url)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Pushgateway push failed: %s", exc)
            return False
