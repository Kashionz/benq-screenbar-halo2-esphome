"""Validate the proposed App wire contract, not the ESP32 implementation.

Run: python -m pip install -r protocol/v1/requirements-dev.txt
     python tools/validate_app_protocol.py
"""

import copy
import argparse
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "protocol/v1/schema.json").read_text(encoding="utf-8"))
EXAMPLES = json.loads((ROOT / "protocol/v1/examples.json").read_text(encoding="utf-8"))
BY_NAME = {item["name"]: item["body"] for item in EXAMPLES}


def validator(name):
    return Draft202012Validator({**SCHEMA, "$ref": f"#/$defs/{name}"})


class AppProtocolContractTests(unittest.TestCase):
    def test_schema_and_examples(self):
        Draft202012Validator.check_schema(SCHEMA)
        self.assertEqual(len(EXAMPLES), len(BY_NAME), "Duplicate fixture name")
        for item in EXAMPLES:
            with self.subTest(example=item["name"]):
                validator(item["schema"]).validate(item["body"])
                limit = 1024 if item["schema"] == "CommandRequest" else 8192
                self.assertLessEqual(len(json.dumps(item["body"]).encode()), limit)

    def test_invalid_command_fields(self):
        bad_patches = [
            {}, {"power": "false"}, {"power": 0}, {"power": None},
            {"front_brightness": 0}, {"back_brightness": 101},
            {"front_brightness": True}, {"back_brightness": 1.5},
            {"temperature_k": 2699}, {"temperature_k": 6501},
            {"temperature_k": 3926}, {"mode": "off"},
            {"front": True}, {"ultrasonic_enabled": 1}, {"auto_dimming": "on"},
        ]
        for patch in bad_patches:
            with self.subTest(patch=patch):
                request = copy.deepcopy(BY_NAME["power-off-request"])
                request["patch"] = patch
                self.assertFalse(validator("CommandRequest").is_valid(request))
        for field, value in [("expected_revision", -1), ("expected_revision", True),
                             ("not_after_uptime_ms", 2**53),
                             ("boot_id", "not-a-uuid"), ("type", "toggle"),
                             ("unknown_option", True)]:
            with self.subTest(field=field):
                request = copy.deepcopy(BY_NAME["power-off-request"])
                request[field] = value
                self.assertFalse(validator("CommandRequest").is_valid(request))

    def test_valid_patch_boundaries(self):
        for patch in [
            {"power": False}, {"front_brightness": 1, "back_brightness": 100},
            {"temperature_k": 2700}, {"temperature_k": 6500},
            {"mode": "both", "ultrasonic_enabled": False}, {"auto_dimming": True},
        ]:
            with self.subTest(patch=patch):
                request = copy.deepcopy(BY_NAME["power-off-request"])
                request["patch"] = patch
                validator("CommandRequest").validate(request)

    def test_no_confirmed_success_or_missing_terminal_result(self):
        for field, value in [("status", "confirmed"), ("effect", "confirmed"),
                             ("finished_at_uptime_ms", None),
                             ("error", {"code": "TX_MAX_RETRIES", "message": "Failed"})]:
            record = copy.deepcopy(BY_NAME["power-off-transmitted"])
            record[field] = value
            self.assertFalse(validator("CommandRecord").is_valid(record))
        record = copy.deepcopy(BY_NAME["max-retries-not-proof-of-no-effect"])
        record["error"] = None
        self.assertFalse(validator("CommandRecord").is_valid(record))

    def test_auto_dimming_is_optional_in_state(self):
        # Older firmware omits it; newer firmware reports it with its feature flag.
        state = copy.deepcopy(BY_NAME["snapshot-before-command"])
        self.assertIn("auto_dimming", state["desired"]["values"])
        del state["desired"]["values"]["auto_dimming"]
        del state["features"]["auto_dimming"]
        validator("Snapshot").validate(state)
        state["features"]["auto_dimming"] = "maybe"
        self.assertFalse(validator("Snapshot").is_valid(state))

    def test_forward_compatible_response_fields(self):
        state = copy.deepcopy(BY_NAME["snapshot-before-command"])
        state["future_diagnostic"] = {"value": 1}
        state["desired"]["values"]["future_light_value"] = 1
        validator("Snapshot").validate(state)

    def test_example_semantics(self):
        # Cross-field facts cannot all be expressed in plain JSON Schema.
        for item in EXAMPLES:
            body = item["body"]
            if item["schema"] == "CommandRecord":
                with self.subTest(example=item["name"]):
                    tx = body["tx"]
                    self.assertLessEqual(tx["frames_transmitted"], tx["frames_attempted"])
                    self.assertLessEqual(tx["frames_attempted"], tx["frames_planned"])
                    expected = "unconfirmed" if tx["frames_attempted"] else "not_attempted"
                    self.assertEqual(body["effect"], expected)
                    times = [body[k] for k in ["accepted_at_uptime_ms", "started_at_uptime_ms",
                                               "finished_at_uptime_ms"] if body[k] is not None]
                    self.assertEqual(times, sorted(times))
                    if body["status"] == "transmitted":
                        self.assertEqual(tx["frames_transmitted"], tx["frames_planned"])
                        if tx["irq"] is not None:
                            self.assertTrue(tx["irq"] & 0x20)
                            self.assertFalse(tx["irq"] & 0x10)
                            self.assertTrue(tx["fifo"] & 0x10)
            elif item["schema"] == "Snapshot":
                self.assertLessEqual(body["desired"]["updated_at_uptime_ms"], body["uptime_ms"])
                if body["observed_remote"]:
                    self.assertLessEqual(body["observed_remote"]["received_at_uptime_ms"], body["uptime_ms"])
                for key in ["active_command", "last_command"]:
                    if body[key]:
                        self.assertEqual(body[key]["boot_id"], body["boot_id"])
                        self.assertLessEqual(body[key]["accepted_revision"], body["control_revision"])
        limits = BY_NAME["device-info"]["limits"]
        self.assertGreaterEqual(limits["result_retention_ms"], limits["max_command_future_ms"])
        self.assertGreaterEqual(limits["result_capacity"],
                                limits["result_retention_ms"] // limits["min_command_interval_ms"] + 2)
        after = BY_NAME["snapshot-after-command-remote-still-old"]
        self.assertFalse(after["desired"]["values"]["power"])
        self.assertTrue(after["observed_remote"]["values"]["power"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cpp-fixtures", type=Path)
    args, remaining = parser.parse_known_args()
    if args.cpp_fixtures:
        fixtures = json.loads(args.cpp_fixtures.read_text(encoding="utf-8-sig"))
        for name, body in fixtures.items():
            validator("CommandRecord" if name == "Accepted" else name).validate(body)
        print(f"Validated {len(fixtures)} C++ encoder fixtures")
    unittest.main(argv=[__file__, *remaining], verbosity=2)
