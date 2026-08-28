/**
 * Harmony control-token sanitiser for streamed model text (issue #222).
 *
 * The gpt-oss / harmony model family sometimes leaks its internal channel
 * framing into the plain `text-delta` stream, e.g.
 *
 *   <|channel|>thought<|channel|>reasoning<|channel|>final<|channel|>answer<|end|>
 *
 * or the full form with role headers:
 *
 *   <|start|>assistant<|channel|>final<|message|>answer<|end|>
 *
 * These `<|...|>` control tokens — and the model's private "thought"/"analysis"
 * reasoning — must never reach the user or get persisted to chat history.
 *
 * `createHarmonyFilter` returns an incremental filter: feed each streamed chunk
 * through `push()` and it returns only the user-facing text. Because a marker
 * can be split across two deltas (`<|chan` + `nel|>`), an ambiguous trailing
 * fragment is held back until the next chunk (or `flush()`) resolves it.
 *
 * Channel handling: text in the `final` channel (or before any channel marker)
 * is emitted; text in a `thought`/`analysis`/etc. channel is suppressed. As a
 * safety net, if the whole stream emitted nothing but did buffer suppressed
 * content (a model that mis-tagged its only answer as "thought"), that buffer is
 * flushed rather than showing the user an empty reply.
 */

/** Channels whose content is shown to the user. `""` is the pre-channel default. */
const EMIT_CHANNELS = new Set(["", "final"]);

interface HarmonyFilter {
  /** Feed a streamed chunk; returns the user-facing text ready to emit now. */
  push(chunk: string): string;
  /** Signal end of stream; returns any held-back or salvaged trailing text. */
  flush(): string;
}

/**
 * Defensive pass for malformed harmony fragments the tokenizer can't catch
 * because they are missing a pipe (e.g. `<channel|>`), which have been observed
 * in real leaks (#222). Runs on assembled text runs, never across a chunk
 * boundary, so a partial fragment is never half-stripped.
 */
function stripResidualMarkers(text: string): string {
  return text.replace(/<\|?(?:channel|message|start|end|return|constrain)\|?>/gi, "");
}

export function createHarmonyFilter(): HarmonyFilter {
  let buffer = "";
  let channel = ""; // current channel; "" = default (before any channel marker)
  let awaitingName = false; // inside a channel-name section (between two markers)
  let consumeHeader = false; // after <|start|>, discard the role header
  let nameAcc = "";
  let emittedAny = false;
  let suppressed = "";

  /** Route a completed text run to the output, suppress buffer, or metadata. */
  const routeText = (text: string): string => {
    if (text.length === 0) return "";
    // Role header after <|start|>: discard until a control token ends it.
    if (consumeHeader) return "";
    // Channel name between markers: accumulate until a control token finalises it.
    if (awaitingName) {
      nameAcc += text;
      return "";
    }
    const clean = stripResidualMarkers(text);
    if (EMIT_CHANNELS.has(channel)) {
      if (clean.length > 0) emittedAny = true;
      return clean;
    }
    // Non-final channel (thought/analysis/…): buffer in case it is the only
    // content the model ever produced.
    suppressed += clean;
    return "";
  };

  /** Apply a complete `<|...|>` control token's effect to the filter state. */
  const handleToken = (token: string): void => {
    consumeHeader = false;
    if (token === "<|channel|>") {
      if (awaitingName) {
        // Second marker of a header: the name is complete, content follows.
        channel = nameAcc.trim();
        awaitingName = false;
        nameAcc = "";
      } else {
        awaitingName = true;
        nameAcc = "";
      }
      return;
    }
    if (token === "<|message|>") {
      // Full-form separator: closes a channel name, content follows.
      if (awaitingName) {
        channel = nameAcc.trim();
        awaitingName = false;
        nameAcc = "";
      }
      return;
    }
    if (token === "<|start|>") {
      channel = "";
      awaitingName = false;
      nameAcc = "";
      consumeHeader = true;
      return;
    }
    // <|end|>, <|return|>, and any other control token: end the current section.
    channel = "";
    awaitingName = false;
    nameAcc = "";
  };

  /** Consume as much of `buffer` as is unambiguous; hold partial markers back. */
  const drain = (final: boolean): string => {
    let out = "";
    while (buffer.length > 0) {
      const open = buffer.indexOf("<|");
      if (open === -1) {
        // No token start in view. A trailing lone '<' might begin '<|' next
        // chunk, so hold it back until we know (dropping a stray '<' at flush).
        if (!final && buffer.endsWith("<")) {
          out += routeText(buffer.slice(0, -1));
          buffer = "<";
        } else if (final && buffer === "<") {
          buffer = "";
        } else {
          out += routeText(buffer);
          buffer = "";
        }
        break;
      }
      // Text before the token start is safe to route now.
      if (open > 0) {
        out += routeText(buffer.slice(0, open));
        buffer = buffer.slice(open);
      }
      // buffer now starts with "<|". Find the token close.
      const close = buffer.indexOf("|>");
      if (close === -1) {
        // Incomplete control token: wait for more input, or drop it at flush.
        if (final) buffer = "";
        break;
      }
      handleToken(buffer.slice(0, close + 2));
      buffer = buffer.slice(close + 2);
    }
    return out;
  };

  return {
    push(chunk: string): string {
      buffer += chunk;
      return drain(false);
    },
    flush(): string {
      let out = drain(true);
      // Nothing was ever emitted but a channel was suppressed → the model
      // mis-tagged its only answer; show it rather than an empty reply.
      if (!emittedAny && suppressed.length > 0) {
        out += suppressed;
      }
      suppressed = "";
      return out;
    },
  };
}
