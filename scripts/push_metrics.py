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
    """Emit layer metrics to the Pushgateway.

    The same code runs in two places: the ingestion scripts on the host and the
    Spark jobs inside the Docker network. `pushgateway` only resolves inside
    the network, and `localhost` only works from the host — so try both rather
    than silently dropping every Bronze metric when run from the host, which is
    what left the Grafana panels empty.
    """

    def __init__(self, host: str | None = None, port: int | None = None, job: str = "bigdata"):
        configured = host or os.environ.get("PUSHGATEWAY_HOST")
        self.hosts = [configured] if configured else ["pushgateway", "localhost"]
        self.port = port or int(os.environ.get("PUSHGATEWAY_PORT", "9091"))
        self.job = job
        self._metrics: list[tuple[str, dict, float]] = []

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

        # urllib, not requests: this module is imported by the Spark jobs, and
        # the apache/spark image ships no third-party packages. A missing
        # `requests` used to make every Silver and Gold metric push vanish.
        import urllib.error
        import urllib.request

        payload = body.encode("utf-8")
        last_error: Exception | None = None
        for host in self.hosts:
            url = f"http://{host}:{self.port}/metrics/job/{self.job}"
            try:
                request = urllib.request.Request(
                    url, data=payload, method="PUT", headers={"Content-Type": "text/plain"}
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    if response.status >= 400:
                        raise RuntimeError(f"HTTP {response.status}")
                self._metrics.clear()
                # Stick to the host that worked for the rest of this process.
                self.hosts = [host]
                logger.info("Pushed %d metrics to %s", len(body_lines), url)
                return True
            except Exception as exc:  # noqa: BLE001
                last_error = exc

        # Monitoring must never fail the pipeline, so this stays a warning.
        logger.warning("Pushgateway push failed (tried %s): %s", ", ".join(self.hosts), last_error)
        return False
