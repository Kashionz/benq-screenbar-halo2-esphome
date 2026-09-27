import unittest
from unittest.mock import patch
import json

from tools.halo2_client import ApiError, Client, ProtocolError, UnknownOutcome, TransportError
from tools.check_rf_stability import failure_details

BOOT = "22222222-2222-4222-8222-222222222222"


class ClientTests(unittest.TestCase):
    def test_transport_phases_close_without_retry_or_private_details(self):
        for phase, operation in (("connect", "connect"), ("send_request", "request"),
                                 ("response_headers", "getresponse"), ("response_body", "read")):
            with self.subTest(phase=phase), patch("tools.halo2_client.http.client.HTTPConnection") as factory:
                connection = factory.return_value
                response = connection.getresponse.return_value
                target = response if operation == "read" else connection
                getattr(target, operation).side_effect = TimeoutError("private-host secret-password")
                client = Client("private-host", "private-user", "secret-password")
                with self.assertRaises(TransportError) as caught:
                    client.request("POST", "/api/v1/commands", {"power": True})
                detail = failure_details(caught.exception)
                self.assertEqual(detail["transport_phase"], phase)
                self.assertEqual(detail["category"], "timeout")
                self.assertGreaterEqual(detail["elapsed_ms"], 0)
                self.assertNotIn("private", json.dumps(detail) + str(caught.exception))
                self.assertNotIn("secret", json.dumps(detail) + str(caught.exception))
                connection.connect.assert_called_once()
                self.assertEqual(connection.request.call_count, 0 if phase == "connect" else 1)
                connection.close.assert_called_once()

    @patch("tools.halo2_client.http.client.HTTPConnection")
    def test_real_request_path_success_and_api_rejection(self, factory):
        response = factory.return_value.getresponse.return_value
        response.status = 200
        response.read.return_value = b'{"ok":true}'
        response.getheader.return_value = "application/json"
        client = Client("localhost", "test", "test")
        self.assertEqual(client.request("GET", "/api/v1/state"), {"ok": True})
        self.assertEqual(factory.return_value.auto_open, 0)
        response.status = 409
        response.read.return_value = b'{"error":{"code":"REVISION_CONFLICT"}}'
        with self.assertRaises(ApiError):
            client.request("POST", "/api/v1/commands", {})

    def client(self):
        client = Client("127.0.0.1", "test", "test")
        calls = []
        def transport(method, path, body=None):
            calls.append((method, path, body))
            if path.endswith("/info"):
                return {"protocol": {"name": "halo2-bridge", "major": 1}, "boot_id": BOOT}
            if path.endswith("/state"):
                return {"boot_id": BOOT, "control_revision": 3, "uptime_ms": 1000, "features": {"power": "verified", "mode": "experimental"}}
            if method == "POST":
                return {"boot_id": BOOT, "command_id": body["command_id"], "status": "accepted"}
            return {"boot_id": BOOT, "command_id": calls[2][2]["command_id"], "status": "transmitted"}
        client.request = transport
        return client, calls, transport

    @patch("tools.halo2_client.time.sleep")
    def test_one_post_then_lookup(self, _):
        client, calls, _ = self.client()
        self.assertEqual(client.set_state({"power": False})["status"], "transmitted")
        self.assertEqual([c[0] for c in calls], ["GET", "GET", "POST", "GET"])
        self.assertEqual(calls[2][2]["not_after_uptime_ms"], 5000)

    def test_timeout_does_not_resend(self):
        client, calls, transport = self.client()
        def timeout(method, path, body=None):
            result = transport(method, path, body)
            if method == "POST": raise TimeoutError()
            return result
        client.request = timeout
        with self.assertRaises(UnknownOutcome) as result: client.set_state({"power": True})
        self.assertEqual(result.exception.request["boot_id"], BOOT)
        self.assertEqual(sum(c[0] == "POST" for c in calls), 1)

    def test_conflict_does_not_refresh_and_overwrite(self):
        client, calls, transport = self.client()
        def conflict(method, path, body=None):
            result = transport(method, path, body)
            if method == "POST": raise ApiError(409, "REVISION_CONFLICT")
            return result
        client.request = conflict
        with self.assertRaises(ApiError): client.set_state({"power": True})
        self.assertEqual(len(calls), 3)

    def test_unknown_status_not_success(self):
        client, _, transport = self.client()
        def unknown(method, path, body=None):
            result = transport(method, path, body)
            if method == "POST": result["status"] = "future_status"
            return result
        client.request = unknown
        with self.assertRaises(UnknownOutcome): client.set_state({"power": True})

    def test_experimental_requires_opt_in(self):
        client, calls, _ = self.client()
        with self.assertRaises(ProtocolError): client.set_state({"mode": "back"})
        self.assertFalse(any(c[0] == "POST" for c in calls))

    def test_credentials_not_allowed_in_host(self):
        with self.assertRaises(ValueError): Client("user:password@device", "test", "test")


if __name__ == "__main__":
    unittest.main()
