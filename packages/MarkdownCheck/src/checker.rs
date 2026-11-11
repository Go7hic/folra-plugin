use crate::{Status, MAX_DIAGNOSTICS, MAX_OUTPUT_BYTES};
use pulldown_cmark::{BrokenLink, Event, LinkType, Options, Parser, Tag, TagEnd};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Diagnostic {
    start: usize,
    rule: &'static str,
    end: usize,
}

#[derive(Default)]
struct Diagnostics {
    entries: BTreeSet<Diagnostic>,
    truncated: bool,
}

impl Diagnostics {
    fn add(&mut self, rule: &'static str, range: Range<usize>) {
        self.entries.insert(Diagnostic {
            start: range.start,
            rule,
            end: range.end,
        });
        if self.entries.len() > MAX_DIAGNOSTICS {
            self.entries.pop_last();
            self.truncated = true;
        }
    }
}

struct Image {
    range: Range<usize>,
    has_alt: bool,
}

#[derive(Clone, Copy)]
struct Position {
    utf16: usize,
    line: usize,
    column: usize,
}

fn options() -> Options {
    Options::ENABLE_MATH
        | Options::ENABLE_WIKILINKS
        | Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS
}

fn missing_reference(link_type: LinkType) -> bool {
    matches!(
        link_type,
        LinkType::ReferenceUnknown | LinkType::CollapsedUnknown
    )
}

pub(crate) fn check(text: &str) -> Result<Vec<u8>, Status> {
    // Return a placeholder only for explicit references, so the parser decides
    // which speculative bracket matches become actual links or images.
    let callback = |broken: BrokenLink<'_>| {
        if matches!(broken.link_type, LinkType::Reference | LinkType::Collapsed) {
            Some(("".into(), "".into()))
        } else {
            None
        }
    };
    let parser = Parser::new_with_broken_link_callback(text, options(), Some(callback));
    let mut diagnostics = Diagnostics::default();
    let mut images: Vec<Image> = Vec::new();
    let mut previous_heading: Option<u8> = None;
    let mut ignored_depth = 0;
    for (event, range) in parser.into_offset_iter() {
        if ignored_depth > 0 {
            match event {
                Event::Start(_) => ignored_depth += 1,
                Event::End(_) => ignored_depth -= 1,
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(Tag::CodeBlock(_) | Tag::HtmlBlock | Tag::MetadataBlock(_)) => {
                ignored_depth = 1;
            }
            Event::Start(
                Tag::Link {
                    link_type: LinkType::WikiLink { .. },
                    ..
                }
                | Tag::Image {
                    link_type: LinkType::WikiLink { .. },
                    ..
                },
            ) => {
                ignored_depth = 1;
            }
            Event::Start(Tag::Heading { level, .. }) => {
                let level = level as u8;
                if previous_heading.is_some_and(|previous| level > previous + 1) {
                    let end =
                        range.start + text[range.clone()].trim_end_matches(['\r', '\n']).len();
                    diagnostics.add("MD001", range.start..end);
                }
                previous_heading = Some(level);
            }
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                ..
            }) => {
                if missing_reference(link_type) {
                    diagnostics.add("MD052", range);
                } else if dest_url.is_empty() {
                    diagnostics.add("MD042", range);
                }
            }
            Event::Start(Tag::Image { link_type, .. }) => {
                if missing_reference(link_type) {
                    diagnostics.add("MD052", range.clone());
                }
                images.push(Image {
                    range,
                    has_alt: false,
                });
            }
            Event::End(TagEnd::Image) => {
                if let Some(image) = images.pop() {
                    if !image.has_alt {
                        diagnostics.add("MD045", image.range);
                    }
                }
            }
            Event::Text(content)
            | Event::Code(content)
            | Event::InlineMath(content)
            | Event::DisplayMath(content)
            | Event::FootnoteReference(content)
                if !images.is_empty() =>
            {
                if content.chars().any(|character| !character.is_whitespace()) {
                    for image in &mut images {
                        image.has_alt = true;
                    }
                }
            }
            _ => {}
        }
    }
    let positions = positions(text, &diagnostics.entries);
    let mut items: Vec<Value> = Vec::with_capacity(diagnostics.entries.len());
    for diagnostic in diagnostics.entries {
        let start = positions[&diagnostic.start];
        let end = positions[&diagnostic.end];
        items.push(json!({
            "rule": diagnostic.rule,
            "start": start.utf16,
            "end": end.utf16,
            "line": start.line,
            "column": start.column,
        }));
    }
    let output = json!({ "schema": 1, "diagnostics": items, "truncated": diagnostics.truncated });
    let bytes = serde_json::to_vec(&output).map_err(|_| Status::InternalError)?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        Err(Status::OutputLimit)
    } else {
        Ok(bytes)
    }
}

fn positions(text: &str, diagnostics: &BTreeSet<Diagnostic>) -> BTreeMap<usize, Position> {
    let offsets: BTreeSet<usize> = diagnostics.iter().flat_map(|d| [d.start, d.end]).collect();
    let mut result = BTreeMap::new();
    let mut characters = text.char_indices().peekable();
    let mut position = Position {
        utf16: 0,
        line: 1,
        column: 1,
    };
    let mut previous_cr = false;
    for offset in offsets {
        while let Some(&(index, character)) = characters.peek() {
            if index >= offset {
                break;
            }
            position.utf16 += character.len_utf16();
            match character {
                '\r' => {
                    position.line += 1;
                    position.column = 1;
                }
                '\n' => {
                    if !previous_cr {
                        position.line += 1;
                    }
                    position.column = 1;
                }
                _ => position.column += character.len_utf16(),
            }
            previous_cr = character == '\r';
            characters.next();
        }
        result.insert(offset, position);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_collection_keeps_earliest_unique_diagnostics() {
        let mut diagnostics = Diagnostics::default();
        for start in (0..300).rev() {
            diagnostics.add("MD052", start..start + 1);
            diagnostics.add("MD052", start..start + 1);
        }
        assert!(diagnostics.truncated);
        assert_eq!(diagnostics.entries.len(), MAX_DIAGNOSTICS);
        assert_eq!(diagnostics.entries.first().unwrap().start, 0);
        assert_eq!(diagnostics.entries.last().unwrap().start, 199);
    }
}
