"""Small polling reference client. No dependencies, redirects, or command replay."""
from __future__ import annotations

import argparse
import base64
import getpass
import http.client
import json
import os
import sys
import time
import uuid


class ProtocolError(Exception):
    pass


class ApiError(ProtocolError):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(f"HTTP {status}: {code}")


class UnknownOutcome(ProtocolError):
    def __init__(self, request):
        self.request = request
        super().__init__(f"結果不明；勿自動重送。command_id={request['command_id']} boot_id={request['boot_id']}")


class Client:
    def __init__(self, host, username, password, port=8080, timeout=3):
        if not host or any(c in host for c in "/@?#\r\n"):
            raise ValueError("host 必須是 IP 或主機名稱，不含 URL／帳密")
        self.host, self.port, self.timeout = host, port, timeout
        self.client_id = str(uuid.uuid4())
        self._authorization = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()

    def request(self, method, path, body=None):
        connection = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
        headers = {"Authorization": self._authorization, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
            if len(data) > 1024:
                raise ProtocolError("請求超過 1024 bytes")
            headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, data, headers)
            response = connection.getresponse()
            raw = response.read(8193)
            if len(raw) > 8192 or response.getheader("Content-Type", "").split(";")[0] != "application/json":
                raise ProtocolError("不是 App protocol v1 JSON 回應；請確認韌體與 8080 連接埠")
            try:
                value = json.loads(raw)
            except (ValueError, UnicodeError) as exc:
                raise ProtocolError("橋接器回傳無效 JSON") from exc
            if not isinstance(value, dict):
                raise ProtocolError("橋接器回傳無效物件")
            if response.status not in (200, 202):
                code = value.get("error", {}).get("code", "UNKNOWN_ERROR")
                raise ApiError(response.status, code)
            return value
        finally:
            connection.close()

    def info(self):
        info = self.request("GET", "/api/v1/info")
        protocol = info.get("protocol", {})
        if protocol.get("name") != "halo2-bridge" or protocol.get("major") != 1:
            raise ProtocolError("需要支援 App protocol v1 的橋接器韌體")
        return info

    def state(self):
        return self.request("GET", "/api/v1/state")

    def lookup(self, command_id, boot_id):
        for identifier in (command_id, boot_id):
            if str(uuid.UUID(identifier)) != identifier:
                raise ValueError("UUID 必須是小寫標準格式")
        result = self.request("GET", f"/api/v1/commands/{command_id}?boot_id={boot_id}")
        if result.get("command_id") != command_id or result.get("boot_id") != boot_id:
            raise ProtocolError("命令結果的 ID／開機識別不符")
        return result

    def set_state(self, patch, allow_experimental=False):
        if not isinstance(patch, dict) or not patch:
            raise ProtocolError("patch 必須是非空物件")
        info = self.info()
        state = self.state()
        if state.get("boot_id") != info.get("boot_id"):
            raise ProtocolError("橋接器已重啟，請重新取得狀態後再操作")
        for field in patch:
            feature = state.get("features", {}).get(field, "unsupported")
            if feature != "verified" and not (feature == "experimental" and allow_experimental):
                raise ProtocolError(f"{field} 尚未驗證或不支援；experimental 需明確啟用")
        request = {
            "command_id": str(uuid.uuid4()), "client_id": self.client_id,
            "boot_id": state["boot_id"], "expected_revision": state["control_revision"],
            "not_after_uptime_ms": state["uptime_ms"] + 4000,
            "type": "set_state", "patch": patch,
        }
        try:
            result = self.request("POST", "/api/v1/commands", request)
        except ApiError:
            raise  # A structured rejection is not an accepted command.
        except (OSError, http.client.HTTPException, ProtocolError) as exc:
            raise UnknownOutcome(request) from exc
        end = time.monotonic() + 5
        while True:
            if result.get("boot_id") != request["boot_id"] or result.get("command_id") != request["command_id"]:
                raise UnknownOutcome(request)
            status = result.get("status")
            if status in ("transmitted", "failed", "expired", "superseded"):
                return result
            if status not in ("accepted", "executing") or time.monotonic() >= end:
                raise UnknownOutcome(request)
            time.sleep(0.2)
            try:
                result = self.lookup(request["command_id"], request["boot_id"])
            except (OSError, http.client.HTTPException, ProtocolError) as exc:
                raise UnknownOutcome(request) from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--username", default=os.environ.get("HALO2_USERNAME"))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("info")
    commands.add_parser("state")
    set_parser = commands.add_parser("set")
    set_parser.add_argument("patch", help='例如 {"power":true}')
    set_parser.add_argument("--experimental", action="store_true")
    lookup = commands.add_parser("lookup")
    lookup.add_argument("command_id")
    lookup.add_argument("boot_id")
    args = parser.parse_args()
    username = args.username or input("Web username: ")
    password = os.environ.get("HALO2_PASSWORD") or getpass.getpass("Web password: ")
    client = Client(args.host, username, password, args.port)
    try:
        if args.command == "info": result = client.info()
        elif args.command == "state": result = client.state()
        elif args.command == "lookup": result = client.lookup(args.command_id, args.boot_id)
        else: result = client.set_state(json.loads(args.patch), args.experimental)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if args.command != "set" or result["status"] == "transmitted" else 1
    except (ProtocolError, ValueError, OSError, http.client.HTTPException) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
