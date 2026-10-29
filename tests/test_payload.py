import json
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.validate_payload import PAYLOAD, validate


class PayloadContractTests(unittest.TestCase):
    def test_manifest_and_device_contract(self):
        self.assertEqual(validate(PAYLOAD), [])

    def test_same_version_drift_is_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "canonical"
            shutil.copytree(PAYLOAD, source)
            self.assertEqual(validate(PAYLOAD, source), [])
            (source / "plugin.js").write_bytes((source / "plugin.js").read_bytes() + b"\n// drift\n")
            errors = validate(PAYLOAD, source)
            self.assertIn("payload differs from canonical server: plugin.js", errors)

    def test_rejects_credential_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "plugin"
            shutil.copytree(PAYLOAD, replica)
            manifest = json.loads((replica / "manifest.json").read_text())
            manifest["files"].append("token.json")
            (replica / "manifest.json").write_text(json.dumps(manifest))
            self.assertTrue(any("unsafe/private file name" in err for err in validate(replica)))

    def test_rejects_version_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "plugin"
            shutil.copytree(PAYLOAD, replica)
            manifest = json.loads((replica / "manifest.json").read_text())
            manifest["version"] = "9.9.9"
            (replica / "manifest.json").write_text(json.dumps(manifest))
            self.assertIn("plugin.json disagrees with manifest id, version or files", validate(replica))


if __name__ == "__main__":
    unittest.main()
