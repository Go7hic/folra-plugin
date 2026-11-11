const MAX_EDITS = 256;
const HAN = /^\p{Script=Han}/u;
const HAS_HAN = /\p{Script=Han}/u;
const LATIN_OR_DIGIT = /^(?:[0-9]|\p{Script=Latin})/u;
const PUNCTUATION = { ",": "，", ".": "。", "!": "！", "?": "？", ":": "：", ";": "；" };
const MARKUP = /[\[\]()`$\\|<>{}*_~=\/&#@]|%%/;
const ADDRESS_OR_FIELD = /[\p{L}\p{N}\p{M}]\.\p{L}|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9+.-]:\S|:[ \t]/u;

function run(snapshot) {
  const { spacing, punctuation } = snapshot.params;
  if (!spacing && !punctuation) return { kind: "noop" };

  const edits = [];
  let blockEnd = null;
  let skipParagraph = false;
  let atStart = true;
  // A line match carries its original UTF-16 offset, including preceding CRLFs.
  for (const [line, offset] of sourceLines(snapshot.text)) {
    if (blockEnd) {
      if (blockEnd(line)) blockEnd = null;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      skipParagraph = false;
      continue;
    }
    if (atStart) {
      atStart = false;
      if (trimmed === "---" || trimmed === "+++") {
        blockEnd = source => {
          const end = source.trim();
          return end === trimmed || (trimmed === "---" && end === "...");
        };
        continue;
      }
    }

    const { start, quotes } = blockPrefix(line, true);
    const body = line.slice(start).trimStart();
    if ((body.startsWith("```") || body.startsWith("~~~")) && !/^(?: {4}| {0,3}\t)/.test(line)) {
      blockEnd = fenceEnd(body, quotes, line.startsWith("```"));
      continue;
    }
    if (body.startsWith("$$")) {
      if (!body.includes("$$", 2)) blockEnd = source => source.includes("$$");
      continue;
    }
    if (body.startsWith(":::")) {
      blockEnd = source => source.trimStart().startsWith(":::");
      continue;
    }
    if (body.startsWith("\\[") || body.startsWith("\\(")) {
      const close = body[1] === "[" ? "\\]" : "\\)";
      if (!body.includes(close, 2)) blockEnd = source => source.includes(close);
      continue;
    }
    const htmlEnd = unfinishedHTML(line, body);
    if (htmlEnd) {
      blockEnd = htmlEnd;
      skipParagraph = true;
      continue;
    }
    if (skipParagraph) continue;

    const bracketEnd = body.startsWith("[") ? body.indexOf("]") : -1;
    if (/<[!/?A-Za-z]/.test(line) || (bracketEnd > 1 && body[bracketEnd + 1] === ":") || hasOpenInlineSyntax(line)) {
      skipParagraph = true;
      continue;
    }
    // Restrict edits to plain prose and plain ATX heading text. Indentation,
    // list/quote markers, and inline syntax can all carry source semantics.
    if (line !== body || /^[\s+\-:]/.test(line)) continue;
    const heading = /^#{1,6}(?= )/.exec(line);
    const proseStart = heading ? skipHorizontalSpace(line, heading[0].length) : 0;
    const prose = line.slice(proseStart);
    if (!HAS_HAN.test(prose) || MARKUP.test(prose) || ADDRESS_OR_FIELD.test(prose)) continue;

    if (!collectEdits(prose, offset + proseStart, spacing, punctuation, edits)) {
      return {
        kind: "error",
        code: "unsupported-input",
        message: "Chinese Typography would make more than 256 edits. No changes were made."
      };
    }
  }

  return edits.length ? { kind: "edits", edits } : { kind: "noop" };
}

function skipHorizontalSpace(line, start) {
  while (line[start] === " " || line[start] === "\t") start++;
  return start;
}

function blockPrefix(line, allowLists) {
  const list = /(?:[-+*]|\d{1,9}[.)])(?=[ \t])/y;
  let start = skipHorizontalSpace(line, 0);
  let quotes = 0;
  while (start < line.length) {
    if (line[start] === ">") {
      quotes++;
      start++;
    } else {
      list.lastIndex = start;
      if (!allowLists || !list.test(line)) break;
      start = list.lastIndex;
    }
    start = skipHorizontalSpace(line, start);
  }
  return { start, quotes };
}

function fenceEnd(body, quoteDepth, columnZeroBackticks) {
  const marker = body[0];
  let size = 3;
  while (body[size] === marker) size++;
  return line => {
    const { start, quotes } = blockPrefix(line, false);
    if (quotes !== quoteDepth || line[start] !== marker) return false;
    // Folra treats column-zero backticks as a separate kind of fence.
    if (!quotes && (start > 3 || (marker === "`" && (start === 0) !== columnZeroBackticks))) return false;
    let end = start;
    while (line[end] === marker) end++;
    return end - start >= size && skipHorizontalSpace(line, end) === line.length;
  };
}

function* sourceLines(text) {
  const breaks = /\r\n|[\r\n\u0085\u2028\u2029]/g;
  let start = 0;
  for (const match of text.matchAll(breaks)) {
    yield [text.slice(start, match.index), start];
    start = match.index + match[0].length;
  }
  if (start < text.length) yield [text.slice(start), start];
}

function unfinishedHTML(line, body) {
  const tag = /^<([a-z][a-z0-9-]{0,63})(?=[\s/>]|$)/i.exec(body);
  const voidTag = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  if (tag && !voidTag.test(tag[1])) {
    const end = htmlBlockEnd(tag[1].toLowerCase());
    if (!end(body)) return end;
  }
  if (line.lastIndexOf("<!--") > line.lastIndexOf("-->")) return source => source.includes("-->");
  if (line.lastIndexOf("<![CDATA[") > line.lastIndexOf("]]>")) return source => source.includes("]]>");
  if (line.lastIndexOf("<?") > line.lastIndexOf("?>")) return source => source.includes("?>");
  if (line.lastIndexOf("<") > line.lastIndexOf(">") && /<[!/?A-Za-z]/.test(line)) return source => source.includes(">");
  return null;
}

function htmlBlockEnd(root) {
  const tokens = /<!--|-->|<!\[CDATA\[|\]\]>|<\?|\?>|<(\/?)([a-z][a-z0-9-]{0,63})(?=[\s/>]|$)|\/>|[>"']/gi;
  const terminators = { "<!--": "-->", "<![CDATA[": "]]>", "<?": "?>" };
  let depth = 0;
  let until = "";
  let raw = "";
  let tag = null;
  let quote = "";
  return line => {
    for (const [token, slash, name] of line.matchAll(tokens)) {
      if (until) {
        if (token === until) until = "";
      } else if (tag) {
        if (quote) {
          if (token === quote) quote = "";
        } else if (token === '"' || token === "'") {
          quote = token;
        } else if (token === ">" || token === "/>") {
          if (tag.name === root) {
            if (tag.closing) depth--;
            else if (token === ">") depth++;
          }
          if (!tag.closing && token === ">" && /^(?:script|style|textarea)$/.test(tag.name)) raw = tag.name;
          tag = null;
        }
      } else if (raw) {
        if (slash && name.toLowerCase() === raw) {
          tag = { name: raw, closing: true };
          raw = "";
        }
      } else if (name) {
        tag = { name: name.toLowerCase(), closing: slash === "/" };
      } else {
        until = terminators[token] || "";
      }
    }
    return depth <= 0 && !tag && !raw && !until;
  };
}

function hasOpenInlineSyntax(line) {
  let ticks = 0;
  let brackets = 0;
  let parentheses = 0;
  const tokens = /\\[^\r\n]|[`\[\]()]/g;
  for (let match; (match = tokens.exec(line)) !== null;) {
    const token = match[0];
    if (token === "`") {
      while (line[tokens.lastIndex] === "`") tokens.lastIndex++;
      const count = tokens.lastIndex - match.index;
      if (!ticks) ticks = count;
      else if (ticks === count) ticks = 0;
    } else if (!ticks) {
      if (token === "[") brackets++;
      if (token === "]" && brackets) brackets--;
      if (token === "(") parentheses++;
      if (token === ")" && parentheses) parentheses--;
    }
  }
  return ticks > 0 || brackets > 0 || parentheses > 0;
}

function collectEdits(prose, offset, spacing, punctuation, edits) {
  let previous = "";
  const followingHan = /\p{Script=Han}/uy;

  for (const match of prose.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const glyph = match[0];
    let kind = "";
    if (HAN.test(glyph)) kind = "han";
    else if (LATIN_OR_DIGIT.test(glyph) && !glyph.endsWith("\u20e3")) kind = "latin-or-digit";
    const start = offset + match.index;

    if (spacing && kind && previous && kind !== previous) {
      edits.push({ start, end: start, text: " " });
    } else if (punctuation && previous === "han" && Object.hasOwn(PUNCTUATION, glyph)) {
      const following = glyph === ":" ? match.index + 1 : skipHorizontalSpace(prose, match.index + 1);
      followingHan.lastIndex = following;
      if (followingHan.test(prose) || (".!?".includes(glyph) && following === prose.length)) {
        edits.push({ start, end: start + 1, text: PUNCTUATION[glyph] });
      }
    }
    if (edits.length > MAX_EDITS) return false;
    previous = kind;
  }
  return true;
}
