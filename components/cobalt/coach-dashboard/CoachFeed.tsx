"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import type { AnalysisBlock, TrendDirection } from "@/lib/ai/tools";
import {
  buildCoachFeedRequest,
  type CoachFeedActivityInput,
  parseFeedLine,
} from "@/lib/coach/feed";
import { cn } from "@/lib/utils";

// "Coach-feed" (issue #34, bottom section). On mount it POSTs the athlete's
// progression context to /api/ai/analyze and renders the streamed coach cards
// (#33) the instant each NDJSON line lands — so insight appears progressively.
// With no AI key configured the endpoint streams a deterministic, data-grounded
// analysis, so the feed always fills in the public demo.

type Status = "streaming" | "done" | "error";

const ARROW: Record<TrendDirection, string> = { up: "↑", down: "↓", flat: "→" };

/** A block flattened to the fields the Cobalt Glass card renders. */
interface FeedCardView {
  kicker: string;
  title: string;
  body: string;
  metric?: string;
  direction?: TrendDirection;
  /** insight (cobalt), warning (red), milestone (cobalt-solid). */
  tone: "insight" | "warning" | "milestone";
}

/** Project any analysis block onto the shared feed-card shape. */
function feedCardView(block: AnalysisBlock): FeedCardView {
  switch (block.tool) {
    case "coachInsight":
      return {
        kicker: "Coach",
        title: block.title,
        body: block.body,
        metric: block.data.changeLabel
          ? `${block.data.value} · ${block.data.changeLabel}`
          : block.data.value,
        direction: block.data.direction,
        tone: block.type,
      };
    case "trendCallout":
      return {
        kicker: "Trend",
        title: block.title,
        body: block.body,
        metric: `${block.metric} · ${block.changeLabel}`,
        direction: block.direction,
        tone: block.direction === "down" ? "warning" : "insight",
      };
    case "metricComparison":
      return {
        kicker: "Sammenligning",
        title: block.title,
        body: `${block.current} nu mod ${block.previous} før.`,
        metric: block.deltaLabel,
        direction: block.better,
        tone: "insight",
      };
    case "insightCard":
      return {
        kicker: "Indsigt",
        title: block.title,
        body: block.body,
        metric: block.metric,
        tone: block.sentiment === "caution" ? "warning" : "insight",
      };
    case "workoutRecommendation":
      return {
        kicker: "Forslag",
        title: block.title,
        body: block.rationale,
        metric: block.distanceKm ? `${block.workoutType} · ${block.distanceKm} km` : block.details,
        tone: "insight",
      };
  }
}

function FeedCard({ view }: { view: FeedCardView }) {
  const cobaltSurface = view.tone === "milestone";
  return (
    <GlassCard
      variant={cobaltSurface ? "cobalt" : "default"}
      className="flex flex-col gap-2.5 p-[22px] [animation:cg-fade-up_0.5s_ease_both] motion-reduce:[animation:none]"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "cg-label tracking-[0.18em]",
            cobaltSurface ? "text-silver/90" : "text-ink"
          )}
        >
          {view.kicker}
        </span>
        {view.metric ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-cg-mono text-[11px] font-semibold",
              view.tone === "warning"
                ? "bg-red/12 text-red"
                : cobaltSurface
                  ? "bg-silver/15 text-silver"
                  : "bg-cobalt/10 text-cobalt"
            )}
          >
            {view.direction ? <span aria-hidden="true">{ARROW[view.direction]}</span> : null}
            {view.metric}
          </span>
        ) : null}
      </div>
      <h3
        className={cn(
          "m-0 font-cg-display text-[19px] leading-tight",
          cobaltSurface ? "text-silver" : "text-cobalt"
        )}
      >
        {view.title}
      </h3>
      <p
        className={cn(
          "m-0 text-[13.5px] leading-relaxed",
          cobaltSurface ? "text-silver/85" : "text-ink"
        )}
      >
        {view.body}
      </p>
    </GlassCard>
  );
}

export function CoachFeed({ activities }: { activities: CoachFeedActivityInput[] }) {
  const [status, setStatus] = useState<Status>("streaming");
  const [blocks, setBlocks] = useState<AnalysisBlock[]>([]);
  // Guard against StrictMode's double-invoke firing two concurrent streams.
  const startedRef = useRef(false);

  const runFeed = useCallback(async () => {
    setStatus("streaming");
    setBlocks([]);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCoachFeedRequest(activities)),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const push = (line: string) => {
        const block = parseFeedLine(line);
        if (block) setBlocks((prev) => [...prev, block]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          push(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      push(buffer);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, [activities]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runFeed();
  }, [runFeed]);

  const regenerate = useCallback(() => {
    void runFeed();
  }, [runFeed]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <RunnerGlyph size={20} stroke="var(--color-cobalt)" head="var(--color-red)" />
          <span className="cg-label tracking-[0.2em]">Coach-feed</span>
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={status === "streaming"}
          className="cg-interactive rounded-pill border border-cobalt/25 px-[14px] py-[6px] text-[11.5px] font-medium text-cobalt transition-colors hover:bg-cobalt/8 disabled:cursor-default disabled:opacity-50"
        >
          {status === "streaming" ? "Analyserer…" : "Genanalyser"}
        </button>
      </div>

      {status === "error" ? (
        <GlassCard className="p-[22px] text-[13.5px] text-ink">
          Kunne ikke hente coach-feedet lige nu. Prøv igen.
        </GlassCard>
      ) : blocks.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {blocks.map((block, i) => (
            <FeedCard
              // biome-ignore lint/suspicious/noArrayIndexKey: stream is append-only, never reordered
              key={i}
              view={feedCardView(block)}
            />
          ))}
        </div>
      ) : status === "streaming" ? (
        <GlassCard className="flex items-center gap-2.5 p-[22px] text-[13.5px] text-ink">
          <span className="size-2 animate-pulse rounded-full bg-red" aria-hidden="true" />
          Læser din træning…
        </GlassCard>
      ) : (
        <GlassCard className="p-[22px] text-[13.5px] text-ink">
          Ingen coach-indsigter for perioden endnu.
        </GlassCard>
      )}
    </div>
  );
}
