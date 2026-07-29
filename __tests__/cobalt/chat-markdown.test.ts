import { describe, expect, it } from "vitest";
import { parseChatMarkdown } from "@/lib/cobalt/chat-markdown";

describe("parseChatMarkdown", () => {
  it("wraps a single line in a paragraph block", () => {
    const blocks = parseChatMarkdown("Bliv på denne distance i 2 uger.");
    expect(blocks).toEqual([
      { type: "paragraph", lines: [[{ text: "Bliv på denne distance i 2 uger." }]] },
    ]);
  });

  it("keeps single newlines as line breaks inside one paragraph", () => {
    const blocks = parseChatMarkdown("Første linje\nAnden linje");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        lines: [[{ text: "Første linje" }], [{ text: "Anden linje" }]],
      },
    ]);
  });

  it("splits double newlines into separate paragraph blocks", () => {
    const blocks = parseChatMarkdown("Afsnit et.\n\nAfsnit to.");
    expect(blocks).toEqual([
      { type: "paragraph", lines: [[{ text: "Afsnit et." }]] },
      { type: "paragraph", lines: [[{ text: "Afsnit to." }]] },
    ]);
  });

  it("collapses runs of blank lines without emitting empty paragraphs", () => {
    const blocks = parseChatMarkdown("A\n\n\n\nB");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "paragraph", lines: [[{ text: "A" }]] });
    expect(blocks[1]).toEqual({ type: "paragraph", lines: [[{ text: "B" }]] });
  });

  it("parses **bold** into a bold span", () => {
    const blocks = parseChatMarkdown("**Pas:** 5:30");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        lines: [[{ text: "Pas:", bold: true }, { text: " 5:30" }]],
      },
    ]);
  });

  it("parses *italic* and _italic_ into italic spans", () => {
    expect(parseChatMarkdown("*roligt*")).toEqual([
      { type: "paragraph", lines: [[{ text: "roligt", italic: true }]] },
    ]);
    expect(parseChatMarkdown("_roligt_")).toEqual([
      { type: "paragraph", lines: [[{ text: "roligt", italic: true }]] },
    ]);
  });

  it("groups '-' lines into an unordered list", () => {
    const blocks = parseChatMarkdown("- Rolig Zone 2\n- 45-75 min");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ text: "Rolig Zone 2" }], [{ text: "45-75 min" }]],
      },
    ]);
  });

  it("groups '*' bullet lines into an unordered list", () => {
    const blocks = parseChatMarkdown("* første\n* anden");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ text: "første" }], [{ text: "anden" }]],
      },
    ]);
  });

  it("groups numbered lines into an ordered list", () => {
    const blocks = parseChatMarkdown("1. Løb\n2. Hvil");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: true,
        items: [[{ text: "Løb" }], [{ text: "Hvil" }]],
      },
    ]);
  });

  it("parses inline markdown inside list items", () => {
    const blocks = parseChatMarkdown("- **Zone 2** er nøglen");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ text: "Zone 2", bold: true }, { text: " er nøglen" }]],
      },
    ]);
  });

  it("separates a paragraph from a following list", () => {
    const blocks = parseChatMarkdown("Hvorfor:\n- Aerob kapacitet\n- Sweet spot");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "paragraph", lines: [[{ text: "Hvorfor:" }]] });
    expect(blocks[1]).toEqual({
      type: "list",
      ordered: false,
      items: [[{ text: "Aerob kapacitet" }], [{ text: "Sweet spot" }]],
    });
  });

  it("leaves an unclosed bold marker as literal text (streaming-safe)", () => {
    const blocks = parseChatMarkdown("**Pas");
    expect(blocks).toEqual([{ type: "paragraph", lines: [[{ text: "**Pas" }]] }]);
  });

  it("leaves an unclosed italic marker as literal text (streaming-safe)", () => {
    const blocks = parseChatMarkdown("*rolig");
    expect(blocks).toEqual([{ type: "paragraph", lines: [[{ text: "*rolig" }]] }]);
  });

  it("does not treat HTML as markup — angle brackets survive as literal text", () => {
    const blocks = parseChatMarkdown("<b>hej</b> <script>alert(1)</script>");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        lines: [[{ text: "<b>hej</b> <script>alert(1)</script>" }]],
      },
    ]);
  });

  it("returns no blocks for empty or whitespace-only input", () => {
    expect(parseChatMarkdown("")).toEqual([]);
    expect(parseChatMarkdown("   \n\n  ")).toEqual([]);
  });

  it("parses the full coach answer from the issue", () => {
    const text = [
      "**Pas:** 5:30-6:00 min/km",
      "",
      "**Hvorfor:**",
      "- Rolig Zone 2 opbygger aerob kapacitet",
      "- 45-75 min er sweet spot for mit nuværende niveau",
      "",
      "**Næste skridt:** Bliv på denne distance i 2 uger før progression",
    ].join("\n");
    const blocks = parseChatMarkdown(text);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1]).toEqual({
      type: "paragraph",
      lines: [[{ text: "Hvorfor:", bold: true }]],
    });
    expect(blocks[2].type).toBe("list");
    expect(blocks[3].type).toBe("paragraph");
  });
});
