#!/usr/bin/env python3
"""Build the standalone Folra Markdown Check plugin directory and ZIP."""

import argparse
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
CRATE = ROOT / "packages/MarkdownCheck"
SOURCES = CRATE / "build"
BUILD = ROOT / ".build/official-plugin-build"
RUST_VERSION = "1.97.1"
TARGET = "wasm32-unknown-unknown"
PACKAGE_NAME = "MarkdownCheck.folraplug"
NOTICE = "ThirdPartyLicenses.txt"
SOURCE_LIMIT = 256 * 1024
RULE = "\n\n" + "-" * 60 + "\n\n"


def capture(command):
    return subprocess.check_output(command, cwd=CRATE, text=True).strip()


def read(path):
    return path.read_text(encoding="utf-8").strip()


class NoticeText(HTMLParser):
    # Preserve paragraph breaks when copying the Rust toolchain's HTML notices.
    breaks = {"p", "div", "li", "h1", "h2", "h3", "pre", "br"}

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.breaks:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.breaks:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def rust_notices(sysroot, version, crates):
    notices = sysroot / "share/doc/rust"
    parser = NoticeText()
    parser.feed(read(notices / "COPYRIGHT-library.html"))
    lines = "\n".join(line.rstrip() for line in "".join(parser.parts).splitlines())
    copyright_text = re.sub(r"\n\s*\n(?:\s*\n)+", "\n\n", lines).strip()
    entries = [
        f"Rust Standard Library ({version})\nhttps://www.rust-lang.org/\n\n{copyright_text}",
        read(notices / "licenses/MIT.txt"),
        read(notices / "licenses/Apache-2.0.txt"),
    ]
    for crate in crates:
        name = crate["name"]
        directory = Path(crate["manifest_path"]).parent
        candidates = ("LICENSE-MIT", "LICENSE-MIT.txt", "LICENSE", "LICENSE.txt")
        license_file = next((directory / filename for filename in candidates
                             if (directory / filename).is_file()), None)
        if "MIT" not in (crate["license"] or "") or license_file is None:
            raise ValueError(f"Review Rust dependency license for {name}")
        url = crate["repository"] or f"https://crates.io/crates/{name}"
        entries.append(f"{name} {crate['version']}\n{url}\nMIT License\n\n{read(license_file)}")
    return entries


def linked_crates(cargo):
    metadata = json.loads(capture(cargo + [
        "metadata", "--locked", "--format-version", "1", "--filter-platform", TARGET,
    ]))
    tree = capture(cargo + [
        "tree", "--locked", "--target", TARGET, "--edges", "normal", "--prefix", "none",
    ])
    active = set(re.findall(r"^([\w-]+) v(\S+)", tree, re.MULTILINE))
    crates = [crate for crate in metadata["packages"] if crate["source"] is not None
              and (crate["name"], crate["version"]) in active]
    if not crates:
        raise ValueError("No licenses found for the linked Rust crates")
    return sorted(crates, key=lambda crate: (crate["name"], crate["version"]))


def build_wasm():
    rustc = ["rustc"]
    cargo = ["cargo"]
    if not capture(rustc + ["--version"]).startswith(f"rustc {RUST_VERSION} "):
        rustc.append(f"+{RUST_VERSION}")
        cargo.append(f"+{RUST_VERSION}")
    version = capture(rustc + ["--version"])
    sysroot = Path(capture(rustc + ["--print", "sysroot"]))
    crates = linked_crates(cargo)
    mappings = {ROOT: "/folra", sysroot: "/rust"}
    for crate in crates:
        name = f"{crate['name']}-{crate['version']}"
        mappings[Path(crate["manifest_path"]).parent] = f"/crates/{name}"
    # Keep panic locations useful and independent of local checkout/toolchain paths.
    flags = ["-Cstrip=symbols"]
    flags.extend(f"--remap-path-prefix={path}={replacement}" for path, replacement in mappings.items())
    subprocess.run(cargo + [
        "build", "--locked", "--release", "--lib", "--target", TARGET,
        "--target-dir", str(BUILD / "target"),
    ], cwd=CRATE, env={**os.environ, "CARGO_ENCODED_RUSTFLAGS": "\x1f".join(flags)}, check=True)
    wasm = BUILD / "target" / TARGET / "release/folra_markdown_check.wasm"
    return wasm, rust_notices(sysroot, version, crates)


def compile_script(wasm, command, tools):
    for name in ("package.json", "npm-shrinkwrap.json", "compile.mjs"):
        shutil.copyfile(SOURCES / name, tools / name)
    subprocess.run([
        "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund",
        "--userconfig=/dev/null", "--registry=https://registry.npmjs.org",
    ], cwd=tools, check=True)
    subprocess.run(["node", str(tools / "compile.mjs"), str(wasm), str(command), str(SOURCES)], check=True)
    data = command.read_bytes()
    if not 0 < len(data) <= SOURCE_LIMIT or not data.isascii() or b"\0" in data:
        raise ValueError(f"command.js must be nonempty ASCII of at most {SOURCE_LIMIT} bytes")
    modules = tools / "node_modules"
    return [
        "Binaryen 123.0.0 (wasm2js-generated runtime)\nhttps://github.com/WebAssembly/binaryen\n\n"
        + read(modules / "binaryen/LICENSE"),
        "fflate 0.8.2 (raw DEFLATE inflater)\nhttps://github.com/101arrowz/fflate\n\n"
        + read(modules / "fflate/LICENSE"),
    ]


def archive_package(archive, package):
    with ZipFile(archive, "w") as zip_file:
        for path in sorted(package.iterdir()):
            info = ZipInfo(f"{PACKAGE_NAME}/{path.name}")
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            zip_file.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=BUILD,
                        help="artifact directory (default: .build/official-plugin-build)")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    BUILD.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    wasm, notices = build_wasm()
    with (TemporaryDirectory(prefix="tools-", dir=BUILD) as tools,
          TemporaryDirectory(prefix=".markdown-check-", dir=output) as stage):
        package = Path(stage) / PACKAGE_NAME
        package.mkdir()
        manifest = package / "manifest.json"
        shutil.copyfile(SOURCES / manifest.name, manifest)
        version = json.loads(read(manifest))["version"]
        command = package / "command.js"
        notices.extend(compile_script(wasm, command, Path(tools)))
        (package / NOTICE).write_text("Folra Markdown Check third-party licenses\n\n"
                                     + RULE.join(notices) + "\n", encoding="utf-8")

        archive = Path(stage) / f"MarkdownCheck-{version}.zip"
        archive_package(archive, package)
        destination = output / PACKAGE_NAME
        if destination.is_symlink():
            raise ValueError(f"Package destination is a symbolic link: {destination}")
        if destination.exists():
            for path in sorted(package.iterdir()):
                path.replace(destination / path.name)
        else:
            package.rename(destination)
        archive.replace(output / archive.name)

    print(f"{TARGET}: {wasm.stat().st_size} bytes")
    print(f"Plugin: {destination}")
    print(f"ZIP: {output / archive.name} ({(output / archive.name).stat().st_size} bytes)")


if __name__ == "__main__":
    main()
