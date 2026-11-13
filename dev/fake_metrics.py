"""Made-up PVC usage, forecasts and anomaly scores for the dev stack.

`backfill DIR` writes 14 days of history as OpenMetrics to DIR/backfill.om (loaded with
`promtool tsdb create-blocks-from openmetrics`) and the start time to DIR/start. `serve DIR`
then serves the same series live on :8000, so the history and the scrapes join up.

Every value is a function of time, so both modes agree:
- kubelet_volume_stats_{used,capacity}_bytes for two PVCs: data-kafka-0 grows from 60% to
  72% in 14 days with a daily wave, a spike (+15 pp) 8 days ago and a drop (-11 pp) 5 days ago;
  data-postgres-0 sits near 40%.
- forecast_value / forecast_upper / forecast_lower{horizon="<seconds>"} in percent: horizon 0
  is the expected value over the history, horizons every 6h up to 30 days the forecast made now.
- log_anomaly_score{namespace,pod}: noise near 0.1, above 0.7 at the spike and the drop.
"""

import math
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DAY = 86_400
HISTORY_DAYS = 14
STEP = 300
CAPACITY = 100 * 1024**3
NAMESPACE = "streaming"
HORIZONS = [0] + [h * 6 * 3600 for h in range(1, 4 * 30 + 1)]

PVCS = {
    # name: (pod, start %, growth per day in pp, daily wave in pp)
    "data-kafka-0": ("kafka-0", 60.0, 12.0 / 14, 1.0),
    "data-postgres-0": ("postgres-0", 40.0, 0.05, 0.6),
}


def noise(t: float, seed: int) -> float:
    """Deterministic noise in [-1, 1] for a sample time."""
    x = math.sin(int(t // STEP) * 12.9898 + seed * 78.233) * 43758.5453
    return (x - math.floor(x)) * 2 - 1


def expected(pvc: str, t: float, start: float) -> float:
    _, base, slope, wave = PVCS[pvc]
    days = (t - start) / DAY
    return base + slope * days + wave * math.sin(2 * math.pi * (t % DAY) / DAY)


def anomaly(pvc: str, t: float, start: float) -> float:
    """Extra pp at the spike and the drop (30 minutes each), kafka only."""
    if pvc != "data-kafka-0":
        return 0.0
    for at, size in ((start + 6 * DAY, 15.0), (start + 9 * DAY, -11.0)):
        if at <= t < at + 1800:
            return size
    return 0.0


def usage(pvc: str, t: float, start: float) -> float:
    return expected(pvc, t, start) + 0.3 * noise(t, len(pvc)) + anomaly(pvc, t, start)


def band(horizon: float) -> float:
    return 1.5 + 0.25 * horizon / DAY


def score(pvc: str, t: float, start: float) -> float:
    base = 0.1 + 0.05 * noise(t, 7 + len(pvc))
    a = abs(anomaly(pvc, t, start))
    return min(1.0, base + (0.8 if a > 12 else 0.7 if a > 0 else 0.0))


def samples(t: float, start: float, horizons):
    """(metric, labels, value) at time t."""
    for pvc, (pod, *_rest) in PVCS.items():
        pvc_labels = {"namespace": NAMESPACE, "persistentvolumeclaim": pvc}
        u = usage(pvc, t, start)
        yield "kubelet_volume_stats_used_bytes", pvc_labels, CAPACITY * u / 100
        yield "kubelet_volume_stats_capacity_bytes", pvc_labels, CAPACITY
        for h in horizons:
            f = expected(pvc, t + h, start)
            labels = {**pvc_labels, "horizon": str(h)}
            yield "forecast_value", labels, f
            yield "forecast_upper", labels, f + band(h)
            yield "forecast_lower", labels, f - band(h)
        yield "log_anomaly_score", {"namespace": NAMESPACE, "pod": pod}, score(pvc, t, start)


def fmt_labels(labels) -> str:
    return ",".join(f'{k}="{v}"' for k, v in labels.items())


TYPES = {
    "kubelet_volume_stats_used_bytes": "gauge",
    "kubelet_volume_stats_capacity_bytes": "gauge",
    "forecast_value": "gauge",
    "forecast_upper": "gauge",
    "forecast_lower": "gauge",
    "log_anomaly_score": "gauge",
}


def backfill(directory: str) -> None:
    if os.path.exists(os.path.join(directory, "start")):
        print("history already written", flush=True)
        return
    now = time.time()
    end = now - 10 * 60
    start = end - HISTORY_DAYS * DAY
    # OpenMetrics wants each metric family together.
    families = {name: [] for name in TYPES}
    t = start
    while t <= end:
        # Forecasts ahead only for the last two hours: the panel uses each horizon's newest sample.
        horizons = HORIZONS if end - t < 2 * 3600 else [0]
        for name, labels, value in samples(t, start, horizons):
            families[name].append(f"{name}{{{fmt_labels(labels)}}} {value:.6g} {int(t)}\n")
        t += STEP
    path = os.path.join(directory, "backfill.om")
    with open(path + ".tmp", "w") as f:
        for name, lines in families.items():
            f.write(f"# TYPE {name} {TYPES[name]}\n")
            f.writelines(lines)
        f.write("# EOF\n")
    os.replace(path + ".tmp", path)
    # Written last: the other containers wait for it.
    with open(os.path.join(directory, "start"), "w") as f:
        f.write(str(start))
    print(f"wrote {path}", flush=True)


def serve(directory: str) -> None:
    path = os.path.join(directory, "start")
    while not os.path.exists(path):
        time.sleep(1)
    with open(path) as f:
        start = float(f.read())

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path != "/metrics":
                self.send_response(404)
                self.end_headers()
                return
            families = {name: [f"# TYPE {name} {kind}\n"] for name, kind in TYPES.items()}
            for name, labels, value in samples(time.time(), start, HORIZONS):
                families[name].append(f"{name}{{{fmt_labels(labels)}}} {value:.6g}\n")
            data = "".join(line for lines in families.values() for line in lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    print("serving :8000/metrics", flush=True)
    ThreadingHTTPServer(("", 8000), Handler).serve_forever()


if __name__ == "__main__":
    mode, directory = sys.argv[1], sys.argv[2]
    backfill(directory) if mode == "backfill" else serve(directory)
