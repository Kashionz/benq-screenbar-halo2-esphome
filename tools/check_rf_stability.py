"""Opt-in bounded RF test: repeat current power, stop on change or any failure.

Uses the protocol reference client's transport. This measures bridge TX results,
not lamp acknowledgements, and is not a native App UI test.
"""
import argparse
import getpass
import http.client
import json
import math
import os
from pathlib import Path
import time
import uuid

if __package__:
    from .halo2_client import ApiError, Client, ProtocolError
else:
    from halo2_client import ApiError, Client, ProtocolError


class StopTest(Exception):
    pass


def failure_details(exc):
    """Allowlisted diagnostics only: never serialize exception text or response bodies."""
    if isinstance(exc, ApiError):
        detail = {"category": "http_status"}
        if type(exc.status) is int and 100 <= exc.status <= 599:
            detail["http_status"] = exc.status
        return detail
    if isinstance(exc, TimeoutError):
        return {"category": "timeout"}
    if isinstance(exc, ConnectionError):
        return {"category": "connection"}
    if isinstance(exc, OSError):
        return {"category": "os_error"}
    if isinstance(exc, http.client.HTTPException):
        return {"category": "http_transport"}
    if isinstance(exc, ProtocolError):
        return {"category": "protocol"}
    return {"category": "invalid_data"}


def check_state(state, baseline, revision, previous_command):
    if not isinstance(state.get("desired", {}).get("values", {}).get("power"), bool):
        raise StopTest("INVALID_POWER")
    if (state.get("device_id") != baseline.get("device_id")
            or state.get("boot_id") != baseline.get("boot_id")):
        raise StopTest("DEVICE_OR_BOOT_CHANGED")
    if state.get("control_revision") != revision:
        raise StopTest("CONTROL_CHANGED")
    if state.get("desired", {}).get("values") != baseline["desired"]["values"]:
        raise StopTest("TARGET_CHANGED")
    if previous_command is not None and state["desired"].get("command_id") != previous_command:
        raise StopTest("COMMAND_CHANGED")
    if state.get("active_command") is not None:
        raise StopTest("BUSY")
    if state.get("radio_status") != "ready" or state.get("pairing_status") != "ready":
        raise StopTest("RADIO_UNAVAILABLE")
    if state.get("features", {}).get("power") != "verified":
        raise StopTest("POWER_NOT_VERIFIED")


def command(client, state, emit, sleep=time.sleep, now=time.monotonic):
    request = {
        "command_id": str(uuid.uuid4()), "client_id": client.client_id,
        "boot_id": state["boot_id"], "expected_revision": state["control_revision"],
        "not_after_uptime_ms": state["uptime_ms"] + 4000,
        "type": "set_state", "patch": {"power": state["desired"]["values"]["power"]},
    }
    # Checkpoint before the only POST, so an interruption still leaves an ID to look up.
    emit({"kind": "attempt", "command_id": request["command_id"],
          "boot_id": request["boot_id"], "revision": request["expected_revision"]})
    result = client.request("POST", "/api/v1/commands", request)
    deadline = now() + 5
    while True:
        if (result.get("command_id") != request["command_id"]
                or result.get("boot_id") != request["boot_id"]):
            raise StopTest("UNKNOWN_OUTCOME")
        status = result.get("status")
        if status in ("transmitted", "failed", "expired", "superseded"):
            return result
        if status not in ("accepted", "executing") or now() >= deadline:
            raise StopTest("UNKNOWN_OUTCOME")
        sleep(0.2)
        result = client.lookup(request["command_id"], request["boot_id"])


def run(client, count, interval, emit, sleep=time.sleep, now=time.monotonic):
    if not 1 <= count <= 2881 or not math.isfinite(interval) or interval < 30 or (count - 1) * interval > 86400:
        raise ValueError("count/interval exceed the bounded test limits")
    successful = 0
    started = now()
    reason = "COMPLETE"
    stage = "info"
    failure = None
    try:
        info = client.info()
        stage = "initial_state"
        baseline = client.state()
        if info.get("device_id") != baseline.get("device_id") or info.get("boot_id") != baseline.get("boot_id"):
            raise StopTest("DEVICE_OR_BOOT_CHANGED")
        revision = baseline["control_revision"]
        previous_command = None
        for index in range(count):
            if index:
                stage = "interval"
                sleep(interval)
            stage = "before_command_state"
            state = client.state()
            check_state(state, baseline, revision, previous_command)
            tick = now()
            stage = "command"
            result = command(client, state, emit, sleep, now)
            stage = "tx_result"
            tx = result.get("tx", {})
            emit({"kind": "result", "sample": index + 1,
                  "command_id": result["command_id"], "status": result["status"],
                  "effect": result.get("effect"), "tx": tx,
                  "error_code": (result.get("error") or {}).get("code"),
                  "duration_ms": round((now() - tick) * 1000)})
            if result["status"] != "transmitted":
                raise StopTest("TX_NOT_TRANSMITTED")
            planned = tx.get("frames_planned", 0)
            if (result.get("effect") != "unconfirmed" or result.get("error") is not None
                    or planned not in (1, 2) or tx.get("frames_attempted") != planned
                    or tx.get("frames_transmitted") != planned):
                raise StopTest("INVALID_TX_RESULT")
            successful += 1
            revision += 1
            previous_command = result["command_id"]
            stage = "after_command_state"
            check_state(client.state(), baseline, revision, previous_command)
        stage = "complete"
    except StopTest as exc:
        reason = str(exc)
    except KeyboardInterrupt:
        reason = "INTERRUPTED"
    except (OSError, http.client.HTTPException, ProtocolError, ValueError, KeyError, TypeError, AttributeError) as exc:
        # A transport error after POST may mean it was accepted. Never retry it.
        reason = "REQUEST_FAILED_OR_UNKNOWN"
        failure = failure_details(exc)
    summary = {"kind": "summary", "format": "halo2-rf-soak-v1", "reason": reason,
               "stopped_at": stage,
               "complete": reason == "COMPLETE", "samples_planned": count,
               "successful": successful, "elapsed_ms": round((now() - started) * 1000),
               "lamp_confirmation": "unavailable", "native_ui_test": False}
    if failure is not None:
        summary["failure"] = failure
    emit(summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--interval", type=float, default=30)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--send-rf", action="store_true", help="required explicit opt-in")
    args = parser.parse_args()
    if not args.send_rf:
        parser.error("--send-rf is required; otherwise no connection or command is made")
    if not 1 <= args.count <= 2881 or not 30 <= args.interval <= 86400 or (args.count - 1) * args.interval > 86400:
        parser.error("require count 1..2881, interval >=30 seconds, total schedule <=24h")
    client = Client(args.host, os.environ.get("HALO2_USERNAME") or input("Web username: "),
                    os.environ.get("HALO2_PASSWORD") or getpass.getpass("Web password: "))
    # Exclusive create prevents accidentally overwriting earlier evidence.
    with args.report.open("x", encoding="utf-8") as report:
        def emit(value):
            line = json.dumps(value, ensure_ascii=False)
            report.write(line + "\n")
            report.flush()
            print(line, flush=True)
        summary = run(client, args.count, args.interval, emit)
    return 0 if summary["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
