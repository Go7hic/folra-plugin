use crate::*;
use serde_json::{json, Value};

fn document(text: &str) -> Value {
    let output = check_bytes(text.as_bytes()).unwrap();
    assert!(output.len() <= MAX_OUTPUT_BYTES);
    assert!(output.is_ascii());
    let value: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(value["schema"], 1);
    value
}

fn diagnostics(text: &str) -> Vec<Value> {
    let document = document(text);
    assert_eq!(document["truncated"], false);
    document["diagnostics"].as_array().unwrap().clone()
}

fn assert_spans(text: &str, expected: &[(&str, &str)]) {
    let diagnostics = diagnostics(text);
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let actual: Vec<(String, String)> = diagnostics
        .iter()
        .map(|d| {
            let start = d["start"].as_u64().unwrap() as usize;
            let end = d["end"].as_u64().unwrap() as usize;
            (
                d["rule"].as_str().unwrap().to_owned(),
                String::from_utf16(&utf16[start..end]).unwrap(),
            )
        })
        .collect();
    let expected: Vec<(String, String)> = expected
        .iter()
        .map(|(rule, source)| (rule.to_string(), source.to_string()))
        .collect();
    assert_eq!(actual, expected);
}

#[test]
fn four_rules_report_original_construct_spans() {
    assert_spans(
        include_str!("../tests/fixtures/basic.md"),
        &[
            ("MD001", "##### Skipped four"),
            ("MD042", "[empty]()"),
            ("MD042", "[angle](<>)"),
            ("MD042", "[space](   )"),
            ("MD045", "![](photo.png)"),
            ("MD045", "![   ](photo.png)"),
            ("MD052", "[label][missing]"),
            ("MD052", "[collapsed]"),
            ("MD052", "![photo][unknown]"),
        ],
    );
}

#[test]
fn brackets_and_image_inline_content_follow_parser_events() {
    assert_spans(
        include_str!("../tests/fixtures/brackets.md"),
        &[
            ("MD042", "[outer [inner] text]()"),
            ("MD042", "[escaped \\[inner\\]]()"),
            ("MD052", "[outer [inner] label][undefined]"),
            ("MD052", "[escaped \\[label\\]][absent]"),
            ("MD045", "![<!-- only a comment -->](p)"),
        ],
    );
}

#[test]
fn definitions_can_follow_uses_span_lines_and_fold_case() {
    assert_spans(
        include_str!("../tests/fixtures/definitions.md"),
        &[
            ("MD042", "[empty reference][empty]"),
            ("MD052", "[missing][truly undefined]"),
        ],
    );
}

#[test]
fn ignored_parser_regions_do_not_produce_diagnostics() {
    assert!(diagnostics(include_str!("../tests/fixtures/ignored.md")).is_empty());
    assert!(diagnostics(include_str!("../tests/fixtures/plus-metadata.md")).is_empty());
}

#[test]
fn folra_extensions_keep_visible_markdown_checkable() {
    assert_spans(
        include_str!("../tests/fixtures/folra.md"),
        &[
            ("MD042", "[visible link]()"),
            ("MD042", "[table link]()"),
            ("MD042", "[task link]()"),
            ("MD042", "[footnote link]()"),
        ],
    );
}

#[test]
fn heading_jump_uses_preceding_heading_not_first_level() {
    assert_spans(
        include_str!("../tests/fixtures/headings.md"),
        &[
            ("MD001", "#### H4 jumps"),
            ("MD001", "### H3 jumps"),
            ("MD001", "#### Quoted H4 jumps"),
        ],
    );
}

#[test]
fn unicode_utf16_offsets_columns_and_crlf_are_exact() {
    let text = "😀e\u{301} [x]()\r\n🧑‍💻 ![](p)\r\n[z][none]";
    let diagnostics = diagnostics(text);
    for (diagnostic, rule, source, line, column) in [
        (&diagnostics[0], "MD042", "[x]()", 1, 6),
        (&diagnostics[1], "MD045", "![](p)", 2, 7),
        (&diagnostics[2], "MD052", "[z][none]", 3, 1),
    ] {
        let byte_start = text.find(source).unwrap();
        let start = text[..byte_start].encode_utf16().count();
        let end = start + source.encode_utf16().count();
        assert_eq!(
            *diagnostic,
            json!({
                "rule": rule, "start": start, "end": end, "line": line, "column": column
            })
        );
    }
}

#[test]
fn carriage_return_line_endings_are_counted_once() {
    let output = diagnostics("[x]()\r[y]()\r\n[z]()\n[w]()");
    assert_eq!(
        output
            .iter()
            .map(|d| d["line"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [1, 2, 3, 4]
    );
    assert!(output.iter().all(|d| d["column"] == 1));
}

#[test]
fn inline_links_and_images_do_not_validate_files_or_anchors() {
    assert!(diagnostics("[a](#missing) [b](missing.md) ![alt](missing.png)").is_empty());
    assert!(diagnostics("[ordinary] [with \\[escaped\\]] ![shortcut]").is_empty());
    assert!(diagnostics("![alt]()").is_empty());
}

#[test]
fn alt_requires_visible_content_but_can_be_formatted_or_nested() {
    assert_spans(
        "![  ](p) ![** **](p) ![\\*](p) ![&amp;](p) ![![nested](i)](o)",
        &[("MD045", "![  ](p)")],
    );
    assert_spans(
        "![][undefined]",
        &[("MD045", "![][undefined]"), ("MD052", "![][undefined]")],
    );
}

#[test]
fn limits_are_deterministic_and_retain_earliest_source_order() {
    let text = "[x]()\n".repeat(250);
    let first = document(&text);
    let second = document(&text);
    assert_eq!(first, second);
    assert_eq!(first["truncated"], true);
    let diagnostics = first["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 200);
    assert_eq!(diagnostics.first().unwrap()["start"], 0);
    assert_eq!(diagnostics.last().unwrap()["line"], 200);
    assert_eq!(document(&"[x]()\n".repeat(200))["truncated"], false);
    assert_eq!(document(&"[x]()\n".repeat(201))["truncated"], true);
}

#[test]
fn empty_and_embedded_nul_inputs_have_defined_behavior() {
    assert_eq!(document("")["diagnostics"], json!([]));
    assert_spans("before\0 [x]()", &[("MD042", "[x]()")]);
}

#[test]
fn invalid_utf8_and_input_limits_do_not_poison_next_check() {
    assert_eq!(check_bytes(&[0xff]), Err(Status::InvalidInput));
    assert_eq!(
        check_bytes(&vec![b'a'; MAX_INPUT_BYTES + 1]),
        Err(Status::InputLimit)
    );
    assert_eq!(
        document(&"a".repeat(MAX_INPUT_BYTES))["diagnostics"],
        json!([])
    );
    assert_eq!(diagnostics("[x]()").len(), 1);
}

#[test]
fn independent_calls_are_reentrant() {
    let threads: Vec<_> = (0..4)
        .map(|_| {
            std::thread::spawn(|| {
                for _ in 0..20 {
                    assert_eq!(diagnostics("[x]() ![](p)").len(), 2);
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
}
