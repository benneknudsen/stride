// A deliberately tiny, safe markdown parser for coach chat answers (issue #204).
//
// Language models format their replies with paragraphs, bullet/numbered lists,
// and **bold** / *italic* emphasis. Rendering the raw string drops every line
// break and shows the markdown syntax literally. A full markdown library is
// ~50KB and would happily render links, images, and raw HTML — all of which are
// untrusted here (model output under a strict CSP). So we parse only four things
// and nothing else:
//
//   1. **bold** and *italic* / _italic_ emphasis
//   2. paragraphs (blank line = new paragraph)
//   3. unordered (-, *) and ordered (1.) lists
//   4. single line breaks within a paragraph
//
// The output is a plain data tree; the React renderer (ChatMarkdown.tsx) turns
// it into elements with text as children, so React escapes any angle brackets
// and no model-supplied HTML can ever become markup.
//
// Streaming-safe by construction: an emphasis marker only takes effect once its
// closing marker has arrived. A dangling `**` stays literal text, so a token
// arriving mid-word flips to bold exactly once instead of flickering.

export type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type MarkdownBlock =
  | { type: "paragraph"; lines: InlineSpan[][] }
  | { type: "list"; ordered: boolean; items: InlineSpan[][] };

const UNORDERED_ITEM = /^\s*[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;

// Complete emphasis spans only. Bold is tried before italic so `**x**` never
// reads as an empty italic. Each alternative is non-greedy and bounded to a
// single line (input is always one line here), so an unclosed marker simply
// fails to match and falls through as literal text.
const EMPHASIS = /\*\*([^\n]+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_/g;

function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  EMPHASIS.lastIndex = 0;
  let last = 0;
  let match = EMPHASIS.exec(text);
  while (match !== null) {
    if (match.index > last) {
      spans.push({ text: text.slice(last, match.index) });
    }
    if (match[1] !== undefined) {
      spans.push({ text: match[1], bold: true });
    } else {
      // Groups 2 and 3 are the two italic syntaxes; only one is ever set.
      spans.push({ text: (match[2] ?? match[3]) as string, italic: true });
    }
    last = EMPHASIS.lastIndex;
    match = EMPHASIS.exec(text);
  }
  if (last < text.length) {
    spans.push({ text: text.slice(last) });
  }
  // An empty string (e.g. a blank paragraph line) yields no spans; callers keep
  // the line so it still renders as a break, but a single empty span is noise.
  return spans.length > 0 ? spans : [{ text }];
}

export function parseChatMarkdown(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraph.map(parseInline) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (const line of lines) {
    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered ? null : ORDERED_ITEM.exec(line);

    if (unordered) {
      flushParagraph();
      if (list && !list.ordered) {
        list.items.push(unordered[1]);
      } else {
        flushList();
        list = { ordered: false, items: [unordered[1]] };
      }
    } else if (ordered) {
      flushParagraph();
      if (list?.ordered) {
        list.items.push(ordered[1]);
      } else {
        flushList();
        list = { ordered: true, items: [ordered[1]] };
      }
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return blocks;
}
