import json
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.validate_payload import PAYLOAD, validate


class PayloadContractTests(unittest.TestCase):
    def test_manifest_and_device_contract(self):
        self.assertEqual(validate(PAYLOAD), [])

    def test_stock_1614_static_merged_library_and_search(self):
        payload = json.loads((PAYLOAD / "device.json").read_text())
        manifest = json.loads((PAYLOAD / "manifest.json").read_text())
        self.assertEqual(manifest["version"], "1.6.14")
        browse = payload["browse"]
        self.assertEqual(browse["format"], "json")
        self.assertEqual(browse["page_size"], 10)
        self.assertNotIn("lists_url", browse)
        self.assertNotIn("lists_headers", browse)
        self.assertNotIn("folder_url", browse["fields"])
        self.assertEqual([v["title"] for v in browse["lists"]], [
            "Все книги", "Читаю", "Хочу прочитать", "Прочитано",
            "Загруженные", "Яндекс Книги", "WB Книги", "ЛитРес"])
        base = "https://my.ybx.app/api/v1/crosspoint/"
        self.assertEqual([v["url"].split("?")[0] for v in browse["lists"]], [
            base+"catalog/all", base+"catalog/all", base+"catalog/all",
            base+"catalog/all", base+"catalog/all", base+"catalog",
            base+"wb/catalog", base+"litres/catalog",
        ])
        self.assertEqual(
            [v["url"].split("kind=")[1].split("&")[0] for v in browse["lists"][:5]],
            ["all", "reading", "to_read", "done", "uploaded"])
        self.assertIn("/catalog/all?kind=all&q={query}&", browse["search"]["url"])
        self.assertIn("&stock=1", browse["lists"][-1]["url"])
        self.assertIn("&stock=1", browse["lists"][-2]["url"])
        for entry in browse["lists"]:
            self.assertNotIn("parent", entry)
            self.assertNotIn("id", entry)
            self.assertIn("v=1.6.14", entry["url"])
        self.assertEqual(payload["token"]["file"], "token.json")
        self.assertEqual(payload["download"]["dest_dir"], "/books/ybx")
        self.assertIn("Bearer {token}", payload["download"]["headers"]["Authorization"])
        self.assertLessEqual((PAYLOAD / "device.json").stat().st_size, 8192)

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

    def test_stock_profile_cannot_require_fork_capabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "plugin"
            shutil.copytree(PAYLOAD, replica)
            manifest_path = replica / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["compatibility"]["requires"] = ["catalog.lists.auth"]
            manifest_path.write_text(json.dumps(manifest))
            self.assertTrue(any("fork-only" in err for err in validate(replica)))

    def test_native_extension_must_not_ship_in_stock(self):
        for metadata_file in ("manifest.json", "plugin.json"):
            with self.subTest(metadata_file=metadata_file), tempfile.TemporaryDirectory() as tmp:
                replica = Path(tmp) / "plugin"
                shutil.copytree(PAYLOAD, replica)
                target = replica / metadata_file
                data = json.loads(target.read_text())
                data.setdefault("compatibility", {})["requires"] = ["catalog.folders.json"]
                target.write_text(json.dumps(data))
                self.assertTrue(any("fork-only" in e for e in validate(replica)))
        for field in ("lists_url", "folder_url"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                replica = Path(tmp) / "plugin"
                shutil.copytree(PAYLOAD, replica)
                target = replica / "device.json"
                data = json.loads(target.read_text())
                if field == "lists_url":
                    data["browse"][field] = "https://my.ybx.app/api/v1/crosspoint/catalog/lists"
                else:
                    data["browse"]["fields"][field] = field
                target.write_text(json.dumps(data))
                self.assertTrue(any("fork-only" in e for e in validate(replica)))

    def test_stock_metadata_must_not_advertise_native_capabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "plugin"
            shutil.copytree(PAYLOAD, replica)
            path = replica / "plugin.json"
            doc = json.loads(path.read_text())
            doc["capabilities"].append("catalog.folders.json")
            path.write_text(json.dumps(doc))
            self.assertTrue(any("plugin.json.capabilities" in err
                                for err in validate(replica)))

    def test_missing_request_version_telemetry_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            replica = Path(tmp) / "plugin"
            shutil.copytree(PAYLOAD, replica)
            device_path = replica / "device.json"
            device = json.loads(device_path.read_text())
            device["events"]["reader.session"]["request"]["url"] = (
                "https://my.ybx.app/api/v1/crosspoint/events"
            )
            device_path.write_text(json.dumps(device))
            self.assertTrue(any("each catalog, download, and event URL" in err
                                for err in validate(replica)))

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
