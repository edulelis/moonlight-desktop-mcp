#!/usr/bin/env python3
"""Validate complete JSON protocol output from the host-free native fixture."""
import json
import pathlib
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix="moonlight-native-fixture-") as directory:
    result = subprocess.run([sys.argv[1], str(pathlib.Path(directory) / "latest.ppm")], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise SystemExit(result.stderr or f"native fixture exited {result.returncode}")
    records = [json.loads(line) for line in result.stdout.splitlines()]
    assert records[-1]["type"] == "test_complete"
    errors = {item["requestId"] for item in records if item["type"] == "capture_error"}
    assert errors == {0, 1, 4, 5, 7, 9}, errors
    captures = [item for item in records if item["type"] == "capture"]
    assert len(captures) == 45, len(captures)
    for item in captures:
        assert item["sequence"] > 0 and item["width"] > 0 and item["height"] > 0
        assert item["ageMs"] >= 0 and item["conversionMs"] >= 0 and item["publishMs"] >= 0
    first = {item["requestId"]: item for item in captures}
    assert first[2]["sequence"] == first[3]["sequence"] == 1
    assert (first[2]["width"], first[2]["height"]) == (17, 13)
    assert (first[6]["width"], first[6]["height"]) == (29, 11)
    phase = next(index for index, item in enumerate(records) if item["type"] == "test_phase")
    notifications = [item for item in records[phase:] if item["type"] == "frame"]
    assert len(notifications) == 30, len(notifications)
    assert all(item["ageMs"] == 0 for item in notifications)
    assert all(b["sequence"] == a["sequence"] + 1 for a, b in zip(notifications, notifications[1:]))
    decoders = [item for item in records if item["type"] == "fixture_decoder"]
    assert len(decoders) == 2
    print(json.dumps({"status": "passed", "captures": len(captures), "expected_errors": len(errors), "decoded_notifications": len(notifications), "decoder_comparison": decoders}))
