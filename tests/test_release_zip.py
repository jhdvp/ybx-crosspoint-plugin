import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.build_release_zip import SOURCE, build


class ReleaseZipTests(unittest.TestCase):
    def test_stable_compatible_zip_layout_and_determinism(self):
        manifest = json.loads((SOURCE / "manifest.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / "a.zip", Path(tmp) / "b.zip"
            hash_a = build(a)
            hash_b = build(b)
            self.assertEqual(hash_a, hash_b)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            with zipfile.ZipFile(a) as z:
                self.assertEqual(z.namelist(), ["ybx/"] + [
                    "ybx/" + name for name in manifest["files"]])
                self.assertEqual(z.testzip(), None)
                self.assertEqual(z.read("ybx/manifest.json"), (SOURCE / "manifest.json").read_bytes())
                self.assertNotIn("ybx/token.json", z.namelist())
                self.assertNotIn("ybx/config-user.json", z.namelist())
                self.assertTrue(z.getinfo("ybx/").is_dir())

    def test_rejects_symlink_and_extra_private_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "payload"
            shutil.copytree(SOURCE, replica)
            manifest = json.loads((replica / "manifest.json").read_text())
            manifest["files"].append("token.json")
            (replica / "manifest.json").write_text(json.dumps(manifest))
            (replica / "token.json").write_text('{"access_token":"SHOULD_NOT_SHIP"}')
            with self.assertRaisesRegex(ValueError, "Invalid stock plugin"):
                build(Path(tmp) / "bad.zip", replica)
            self.assertFalse((Path(tmp) / "bad.zip").exists())

    def test_rejects_symlink_replacing_public_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "payload"
            shutil.copytree(SOURCE, replica)
            file = replica / "icon.png"
            file.unlink()
            file.symlink_to(SOURCE / "icon.png")
            with self.assertRaisesRegex(ValueError, "symlinked"):
                build(Path(tmp) / "bad.zip", replica)


if __name__ == "__main__":
    unittest.main()
