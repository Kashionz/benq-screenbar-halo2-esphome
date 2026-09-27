"""Read-only HTTP soak; reports failures without hiding them through retries."""
import json
import socket
import time
import argparse
import getpass
import os
from pathlib import Path
from halo2_client import Client


def check(client, count=120, interval=0.25, observer=None):
    samples = []
    boot = None
    for index in range(count):
        start = time.monotonic()
        sample = {"index": index}
        try:
            state = client.state()
            if boot is None:
                boot = state["boot_id"]
            sample.update(ok=True, same_boot=state["boot_id"] == boot,
                          uptime_ms=state["uptime_ms"])
        except Exception as exc:
            sample.update(ok=False, error=type(exc).__name__)
            sample["tcp"] = {}
            for port in (80, 6053, 8080):
                try:
                    with socket.create_connection((client.host, port), timeout=1):
                        sample["tcp"][str(port)] = True
                except OSError:
                    sample["tcp"][str(port)] = False
        sample["duration_ms"] = round((time.monotonic() - start) * 1000)
        samples.append(sample)
        if observer:
            observer(sample)
        if index % 20 == 19 or not sample["ok"]:
            print(json.dumps(sample), flush=True)
        time.sleep(interval)
    durations = sorted(s["duration_ms"] for s in samples if s["ok"])
    summary = {"count": count, "failed": sum(not s["ok"] for s in samples),
               "boot_changed": any(s.get("same_boot") is False for s in samples),
               "p95_ms": durations[int((len(durations)-1)*.95)] if durations else None,
               "max_ms": max(durations) if durations else None}
    print(json.dumps(summary), flush=True)
    return {"summary": summary, "samples": samples}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--count", type=int, default=120)
    parser.add_argument("--interval", type=float, default=0.25)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.count < 1 or args.interval < 0:
        parser.error("count must be positive and interval nonnegative")
    client = Client(args.host, os.environ.get("HALO2_USERNAME") or input("Web username: "),
                    os.environ.get("HALO2_PASSWORD") or getpass.getpass("Web password: "))
    result = check(client, args.count, args.interval)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    raise SystemExit(1 if result["summary"]["failed"] or result["summary"]["boot_changed"] else 0)
