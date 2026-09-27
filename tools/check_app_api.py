"""Exercise a real bridge's HTTP contract. RF writes require --exercise-power."""
import argparse
import base64
import getpass
import http.client
import json
import os
import time
import uuid

from halo2_client import Client
from validate_app_protocol import validator


def check(host, port, username, password, exercise_power=False):
    auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
    client = Client(host, username, password, port)
    passed = []

    def raw(method, path, body=None, authorized=True, content_type="application/json"):
        connection = http.client.HTTPConnection(host, port, timeout=4)
        headers = {"Content-Type": content_type}
        if authorized: headers["Authorization"] = auth
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            data = response.read(8193)
            assert len(data) <= 8192
            assert response.getheader("Cache-Control") == "no-store"
            assert response.getheader("Content-Type", "").startswith("application/json")
            return response.status, json.loads(data), dict(response.getheaders())
        finally:
            connection.close()

    def error(name, expected_status, expected_code, method, path, body=None, **kwargs):
        status, response, headers = raw(method, path, body, **kwargs)
        assert (status, response["error"]["code"]) == (expected_status, expected_code), (name, status, response)
        validator("Error").validate(response)
        if status == 401:
            assert response["boot_id"] is None and response["control_revision"] is None
            assert "Basic" in headers.get("WWW-Authenticate", "")
        if status == 405: assert "Allow" in headers
        passed.append(name)

    info = client.info(); validator("DeviceInfo").validate(info)
    before = client.state(); validator("Snapshot").validate(before)
    assert before["boot_id"] == info["boot_id"]
    passed.append("info/state schemas")
    for path in ("/info", "/state", "/commands", "/events", "/commands/unknown"):
        error("authentication " + path, 401, "UNAUTHORIZED", "POST" if path == "/commands" else "GET", "/api/v1" + path, authorized=False)
    error("unknown path", 404, "NOT_FOUND", "GET", "/api/v1/missing")
    error("wrong method", 405, "METHOD_NOT_ALLOWED", "PUT", "/api/v1/state")
    error("wrong content type", 415, "UNSUPPORTED_MEDIA_TYPE", "POST", "/api/v1/commands", "{}", content_type="text/plain")
    error("oversized body", 413, "PAYLOAD_TOO_LARGE", "POST", "/api/v1/commands", " " * 1025)
    request = {
        "command_id": str(uuid.uuid4()), "client_id": client.client_id, "boot_id": before["boot_id"],
        "expected_revision": before["control_revision"], "not_after_uptime_ms": before["uptime_ms"] + 4000,
        "type": "set_state", "patch": {"power": before["desired"]["values"]["power"]},
    }
    for label, patch, code in [("null", {"power": None}, 400), ("unknown", {"other": True}, 400), ("range", {"front_brightness": 0}, 422)]:
        invalid = {**request, "patch": patch}
        error(label, code, "INVALID_REQUEST" if code == 400 else "INVALID_VALUE", "POST", "/api/v1/commands", json.dumps(invalid))
    duplicate = json.dumps(request).replace('"patch": {', '"patch": {"power": true,')
    error("duplicate JSON key", 400, "INVALID_REQUEST", "POST", "/api/v1/commands", duplicate)
    error("old boot", 409, "BOOT_CHANGED", "POST", "/api/v1/commands", json.dumps({**request, "boot_id": str(uuid.uuid4())}))
    error("missing lookup boot", 400, "INVALID_REQUEST", "GET", "/api/v1/commands/" + request["command_id"])
    error("unknown command", 404, "COMMAND_NOT_FOUND", "GET", f"/api/v1/commands/{request['command_id']}?boot_id={before['boot_id']}")

    if exercise_power:
        # Keep the starting target. A failed test does not cause an automatic reverse command.
        original = before["desired"]["values"]["power"]
        for power in (not original, original):
            time.sleep(0.6)
            state = client.state()
            request = {**request, "command_id": str(uuid.uuid4()), "boot_id": state["boot_id"],
                       "expected_revision": state["control_revision"], "not_after_uptime_ms": state["uptime_ms"] + 4000,
                       "patch": {"power": power}}
            payload = json.dumps(request)
            status, accepted, _ = raw("POST", "/api/v1/commands", payload)
            assert status == 202
            validator("CommandRecord").validate(accepted)
            result = accepted
            for _ in range(20):
                if result["status"] not in ("accepted", "executing"): break
                time.sleep(0.15); result = client.lookup(request["command_id"], request["boot_id"])
            validator("CommandRecord").validate(result)
            assert result["status"] == "transmitted", result
            status, repeated, _ = raw("POST", "/api/v1/commands", payload)
            assert status == 200 and repeated == result
            status, reordered, _ = raw("POST", "/api/v1/commands", json.dumps(request, sort_keys=True))
            assert status == 200 and reordered == result
            error("same ID changed body", 409, "COMMAND_ID_REUSED", "POST", "/api/v1/commands", json.dumps({**request, "patch": {"power": not power}}))
            print(json.dumps({"power_target": power, "status": result["status"], "tx": result["tx"]}))
            passed.append("power command and duplicate lookup")
        time.sleep(0.6)
        state = client.state()
        error("stale revision", 409, "REVISION_CONFLICT", "POST", "/api/v1/commands", json.dumps({**request, "command_id": str(uuid.uuid4()), "expected_revision": state["control_revision"] - 1, "not_after_uptime_ms": state["uptime_ms"] + 4000}))
        error("expired deadline", 409, "DEADLINE_EXPIRED", "POST", "/api/v1/commands", json.dumps({**request, "command_id": str(uuid.uuid4()), "not_after_uptime_ms": 0}))
    print(json.dumps({"passed": passed, "count": len(passed), "device_id": info["device_id"], "boot_id": info["boot_id"], "physical_lamp_confirmed": False}, ensure_ascii=False, indent=2))
    return info


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--exercise-power", action="store_true")
    args = parser.parse_args()
    username = os.environ.get("HALO2_USERNAME") or input("Web username: ")
    password = os.environ.get("HALO2_PASSWORD") or getpass.getpass("Web password: ")
    check(args.host, args.port, username, password, args.exercise_power)
