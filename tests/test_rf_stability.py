import copy
import unittest
from unittest.mock import patch
from tools.check_rf_stability import main, run


class FakeClient:
    client_id = "test"

    def __init__(self):
        self.current = {"device_id": "device", "boot_id": "boot", "control_revision": 1,
                        "uptime_ms": 100, "desired": {"values": {"power": True}, "command_id": None},
                        "features": {"power": "verified"}, "active_command": None,
                        "radio_status": "ready", "pairing_status": "ready"}
        self.posts = []
        self.status = "transmitted"
        self.timeout = False
        self.after_read = None
        self.reads = 0

    def info(self):
        return {k: self.current[k] for k in ("device_id", "boot_id")}

    def state(self):
        self.reads += 1
        if self.after_read:
            self.after_read(self)
        return copy.deepcopy(self.current)

    def request(self, method, path, body):
        assert method == "POST" and path == "/api/v1/commands"
        assert body["patch"] == {"power": True}
        assert body["expected_revision"] == self.current["control_revision"]
        self.posts.append(body)
        if self.timeout:
            raise TimeoutError()
        self.current["control_revision"] += 1
        self.current["desired"]["command_id"] = body["command_id"]
        return {"command_id": body["command_id"], "boot_id": body["boot_id"],
                "status": self.status, "effect": "unconfirmed", "error": None,
                "tx": {"frames_planned": 1, "frames_attempted": 1, "frames_transmitted": 1}}


class RfStabilityTests(unittest.TestCase):
    def execute(self, client, count=3):
        self.events = []
        return run(client, count, 30, self.events.append, sleep=lambda _: None)

    def test_bounded_success_uses_fresh_ids_and_preserves_power(self):
        client = FakeClient()
        result = self.execute(client)
        self.assertTrue(result["complete"])
        self.assertEqual(result["successful"], 3)
        self.assertEqual(len({p["command_id"] for p in client.posts}), 3)
        self.assertEqual([p["expected_revision"] for p in client.posts], [1, 2, 3])
        self.assertEqual(self.events[0]["kind"], "attempt")

    def test_external_change_before_send_stops_without_post(self):
        client = FakeClient()
        def change(c):
            if c.reads == 2:
                c.current["control_revision"] += 1
        client.after_read = change
        self.assertEqual(self.execute(client)["reason"], "CONTROL_CHANGED")
        self.assertEqual(client.posts, [])

    def test_boot_change_stops_without_post(self):
        client = FakeClient()
        def change(c):
            if c.reads == 2:
                c.current["boot_id"] = "new"
        client.after_read = change
        self.assertEqual(self.execute(client)["reason"], "DEVICE_OR_BOOT_CHANGED")
        self.assertEqual(client.posts, [])

    def test_timeout_keeps_attempt_and_never_reposts(self):
        client = FakeClient()
        client.timeout = True
        result = self.execute(client)
        self.assertFalse(result["complete"])
        self.assertEqual(len(client.posts), 1)
        self.assertEqual([e["kind"] for e in self.events], ["attempt", "summary"])

    def test_terminal_failures_stop_without_retry(self):
        for status in ("failed", "superseded", "expired"):
            client = FakeClient()
            client.status = status
            self.assertEqual(self.execute(client)["reason"], "TX_NOT_TRANSMITTED")
            self.assertEqual(len(client.posts), 1)

    def test_change_after_our_command_prevents_next_command(self):
        client = FakeClient()
        def change(c):
            if c.reads == 3:
                c.current["desired"]["command_id"] = "external"
        client.after_read = change
        self.assertEqual(self.execute(client)["reason"], "COMMAND_CHANGED")
        self.assertEqual(len(client.posts), 1)

    def test_limits_reject_unbounded_or_fast_tests_before_connecting(self):
        for count, interval in [(0, 30), (3000, 30), (2, 1), (2, float('nan')), (2, float('inf'))]:
            with self.assertRaises(ValueError):
                run(None, count, interval, lambda _: None)

    def test_cli_requires_opt_in_before_constructing_client(self):
        with patch("sys.argv", ["check_rf_stability", "--host", "localhost",
                                "--report", "unused.jsonl"]), \
                patch("tools.check_rf_stability.Client") as client, \
                patch("sys.stderr"):
            with self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 2)
            client.assert_not_called()

    def test_accepted_command_is_polled_without_another_post(self):
        client = FakeClient()
        client.status = "accepted"
        def lookup(command_id, boot_id):
            return {"command_id": command_id, "boot_id": boot_id,
                    "status": "transmitted", "effect": "unconfirmed", "error": None,
                    "tx": {"frames_planned": 1, "frames_attempted": 1,
                           "frames_transmitted": 1}}
        client.lookup = lookup
        self.assertTrue(self.execute(client, count=1)["complete"])
        self.assertEqual(len(client.posts), 1)


if __name__ == "__main__":
    unittest.main()
