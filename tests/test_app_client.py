import unittest
from unittest.mock import patch

from tools.halo2_client import ApiError, Client, ProtocolError, UnknownOutcome

BOOT = "22222222-2222-4222-8222-222222222222"


class ClientTests(unittest.TestCase):
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
