#!/usr/bin/env python3
"""Exercise a separately packaged Markdown checker through the signed plugin worker."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def finding(rule, start, end, line, column=1):
    return {"rule": rule, "start": start, "end": end, "line": line, "column": column}


def case(name, source, diagnostics=(), truncated=False):
    return {
        "name": name,
        "input": {
            "api": 2, "scope": "document", "text": source,
            "selection": {"start": 0, "end": 0}, "params": {},
        },
        "expectedResult": {
            "kind": "text",
            "text": json.dumps(
                {"schema": 1, "diagnostics": list(diagnostics), "truncated": truncated},
                sort_keys=True, separators=(",", ":"),
            ),
        },
    }


def main():
    app, package = map(lambda arg: Path(arg).resolve(), sys.argv[1:])
    executable = app / "Contents/MacOS/Folra"
    cases = [
        case("four-rules-and-UTF16-CRLF",
             "# 标题😀\r\n\r\n### Skip\r\n\r\n[x]()\r\n\r\n![](img)\r\n\r\n[x][absent]\r\n",
             [finding("MD001", 10, 18, 3), finding("MD042", 22, 27, 5),
              finding("MD045", 31, 39, 7), finding("MD052", 43, 54, 9)]),
        case("Folra-extensions",
             "[[Wiki]] and ==highlight==<!-- folra:highlight=blue -->.\n\n"
             "$[x][missing]$ and $\\boxed{x}$.\n\n"
             "```md\n[empty]()\n![](image.png)\n[link][missing]\n```\n\n"
             "[link][defined]\n\n[defined]: https://example.com\n"),
        case("unclosed-fence", "```\n[empty]()\n"),
        case("literal-brackets", "ordinary [brackets] in prose"),
        case("truncation", "[x]()\n" * 250,
             [finding("MD042", i * 6, i * 6 + 5, i + 1) for i in range(200)], True),
        case("long-unicode", "中文文档 long document 😀\n\n" * 9000),
        case("long-paragraphs", "[start]()\n\n" + "Plain prose paragraph\n\n" * 24000,
             [finding("MD042", 0, 9, 1)]),
        case("empty", ""),
    ]
    with tempfile.TemporaryDirectory(prefix="folra-checker-cases-") as temporary:
        path = Path(temporary) / "cases.json"
        path.write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
        result = subprocess.run(
            [str(executable), "plugin", "test", str(package), "--cases", str(path)],
            capture_output=True, text=True, timeout=60,
        )
    report = json.loads(result.stdout)
    assert result.returncode == 0 and report["ok"] and report["cases"] == len(cases), report
    print(f"MarkdownCheck: {len(cases)} signed standalone plugin checks passed")
    print(f"Package digest: {report['digest']}")


if __name__ == "__main__":
    main()
