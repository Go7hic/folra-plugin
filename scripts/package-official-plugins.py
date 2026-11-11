#!/usr/bin/env python3
"""Test and archive the Quick Templates and Chinese Typography plugins."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
PLUGINS = (
    ("QuickTemplates", "quick-templates"),
    ("ChineseTypography", "chinese-typography"),
)


def plugin_command(executable, *arguments):
    run = subprocess.run([executable, "plugin", *arguments], capture_output=True, text=True, timeout=90)
    if run.returncode:
        raise SystemExit(run.stdout or run.stderr or "Folra plugin command failed")
    report = json.loads(run.stdout)
    if not report.get("ok"):
        raise SystemExit(run.stdout)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="a signed Folra.app with the plugin CLI")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist/plugins")
    args = parser.parse_args()
    executable = args.app.resolve() / "Contents/MacOS/Folra"
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".official-plugins-", dir=output) as temporary:
        stage = Path(temporary)
        archives = []
        for name, directory in PLUGINS:
            source = ROOT / "plugins/official" / directory
            tested = plugin_command(executable, "test", source)
            package = stage / f"{name}.folraplug"
            packed = plugin_command(executable, "pack", source, package)
            if packed["digest"] != tested["digest"]:
                raise SystemExit(f"{directory} changed between test and pack")
            manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
            archive = stage / f"{name}-{manifest['version']}.zip"
            with ZipFile(archive, "w") as zip_file:
                for item in sorted(package.iterdir()):
                    info = ZipInfo(f"{package.name}/{item.name}")
                    info.create_system = 3
                    info.external_attr = 0o100644 << 16
                    zip_file.writestr(info, item.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
            archives.append((archive, manifest["id"], packed["digest"], tested["cases"]))

        for archive, plugin_id, digest, cases in archives:
            archive.replace(output / archive.name)
            print(f"{output / archive.name} · {plugin_id} · {cases} cases · {digest}")


if __name__ == "__main__":
    main()
