"use client";

import { Fragment, type ReactNode } from "react";
import { type InlineSpan, type MarkdownBlock, parseChatMarkdown } from "@/lib/cobalt/chat-markdown";
import { cn } from "@/lib/utils";

// Renders a coach answer's safe markdown subset (issue #204). The parser only
// ever emits paragraphs, lists, and bold/italic spans — text always reaches
// React as children, never as HTML, so any angle brackets in the (untrusted)
// model output are escaped rather than rendered as markup.

// Content-derived keys keep Biome's noArrayIndexKey happy while staying stable
// as text streams in: the tree is re-parsed from an immutable string and items
// are only ever appended, so an occurrence counter disambiguates duplicates.
function keyer() {
  const seen = new Map<string, number>();
  return (base: string) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  };
}

function InlineSpans({ spans }: { spans: InlineSpan[] }) {
  const key = keyer();
  return (
    <>
      {spans.map((span) => {
        let node: ReactNode = span.text;
        if (span.bold) node = <strong className="font-semibold">{node}</strong>;
        if (span.italic) node = <em>{node}</em>;
        return <Fragment key={key(`s:${span.text}`)}>{node}</Fragment>;
      })}
    </>
  );
}

function Lines({ lines }: { lines: InlineSpan[][] }) {
  const key = keyer();
  return (
    <>
      {lines.map((line, index) => {
        const text = line.map((s) => s.text).join("");
        return (
          <Fragment key={key(`l:${text}`)}>
            {index > 0 ? <br /> : null}
            <InlineSpans spans={line} />
          </Fragment>
        );
      })}
    </>
  );
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks: MarkdownBlock[] = parseChatMarkdown(text);
  const key = keyer();

  return (
    <div className="space-y-2">
      {blocks.map((block) => {
        if (block.type === "list") {
          const itemKey = keyer();
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={key(`list:${block.items.map((i) => i.map((s) => s.text).join("")).join("|")}`)}
              className={cn(
                "space-y-0.5 pl-[1.35em]",
                block.ordered ? "list-decimal" : "list-disc"
              )}
            >
              {block.items.map((item) => {
                const text = item.map((s) => s.text).join("");
                return (
                  <li key={itemKey(`li:${text}`)} className="pl-0.5">
                    <InlineSpans spans={item} />
                  </li>
                );
              })}
            </ListTag>
          );
        }
        const text = block.lines.map((l) => l.map((s) => s.text).join("")).join("\n");
        return (
          <p key={key(`p:${text}`)}>
            <Lines lines={block.lines} />
          </p>
        );
      })}
    </div>
  );
}
